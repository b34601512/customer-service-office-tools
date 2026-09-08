# 16号项目可靠性重构：Codex验收入口

分支：`refactor/boss-fetch-reliability`。基线：`5fb8e1c856160f0b4ad843590b34643ebafc48d6`（PR #652）。
构建标识：`refactor-reliability-20260908`；界面版本 `v0.12-rc1`。
保持独立草稿，未经用户明确确认不要合并 main；旧 PR #652 不作为此次重构的最终验收入口。

## 边界

这是 BOSS 采集主链路及共享终端/任务模块的重构，不承诺网站一定放行。
Codex 上次实机收到的 `code:37 您的环境存在异常` 是网站返回的阻断；本次修复程序的分类、保留现场和人工处理流程。
不更换指纹、轮换账号/IP、伪造请求、提交验证码或直连网站私有接口。
遇验证时不会自动刷新或自动重试；正常登录/验证由用户在原 Edge 页面完成。
只有监听到与原关键词、城市、页码匹配且结构有效的成功响应才继续。后续页若无法回到原页码，停止并保留已有数据，不猜测翻页进度。

## 拆分

- `boss_cdp.py`：浏览器所有权、登录、列表/详情和采集流程；保留主要旧函数入口。
- `boss_transport.py`：每个标签页独立的 CDP 命令/事件/请求缓存。
- `boss_types.py`：返回状态、退出码、错误类型、参数校验。
- `boss_storage.py`：原子导出、逐页 JSONL 检查点、离线恢复。
- `task_runtime.py`：线程生命周期及按线程隔离的 stdout/stderr 捕获。
- `boss_terminal.py`：终端渲染、宽度/高度限制、按键分发。
- `boss_tui.py`：界面、配置、动作和日志摘要，不再混入上述实现。

`run_fetch` 返回兼容 `list` 的 `FetchResult`，附带 `status/paths/checkpoint/completed_pages/reason`。
不要再只凭列表非空或命令没有抛错来判断完全成功。

## 已修复/加强的边界

1. 移除进程级 joblist 响应缓存，避免搜索/详情/登录会话串线；等 `Network.loadingFinished` 后读正文。连接失败即使没有 responseReceived 也会报错。
2. 先打开空白标签页、确认监听启用，再单次导航；命令失败、断连、错页、损坏JSON、结构改变与真正零条分开。
3. 验证时保留原页面；未完成验证不被 finally 关掉。交给用户的备用端口在本进程内可复用，不再误关。
4. 先保存当前页已收到的岗位列表，再补公司全称。停止/异常时保留未补全的岗位，明确留空而非伪造；不再按同一品牌ID推断同一法人主体。
5. 详情连续3次失败即停止后续请求；验证失败立即停止。已有数据仍导出，状态不是完全成功。
6. 每页检查点 flush/fsync，文件导出同目录临时写完后原子替换；CSV防公式执行、JSON保留原文本。磁盘错误不会被取消状态掩盖。
7. 参数拒绝小数页数、布尔值、NaN/Infinity及越界等待时间；无匹配结果不再庆祝“成功导出”。
8. 两个工作线程的输出彼此隔离，不吞主线程输出；线程启动失败、运行中清除任务、迟到的停止标记等有回归用例。
9. 小终端菜单/配置可滚动，帧不越界；日志过滤外部终端控制序列；京东可选依赖缺失不阻断 BOSS 主功能。
10. 修复原京东测试依赖未入库私人 XLSX 的问题，改用独立固定15列表头契约，不改京东业务采集逻辑。

## 已执行的测试（Linux，隔离网站/浏览器）

`python selftest.py`：**120通过、0失败、4跳过**，包含原 PR #652 的25项测试（原文件未修改）、56项可靠性测试、24项兼容测试、6项交付回归和9项京东测试。
跳过：真实Windows控制台1项、真实Edge2项、真实抓取1项。
还执行了 Python编译检查、Python3.10语法检查。没有运行真实 Windows/Edge，也没有重新打包免安装版。

旧自检已迁移为统一入口；旧断言中“空结果也庆祝成功”“停止丢弃已收到的剩余岗位”“同品牌复用法人全称”“Cookie出现就自动刷新”不再保留，分别由更严格的状态/保留数据/来源/人工验证测试代替。
测试中的网页消息是夹具，不应被当作真实采集证据。

## 拉取和离线检查

先确认工作区无未提交改动，不要强制覆盖：

```shell
git fetch origin
git switch --track origin/refactor/boss-fetch-reliability
cd "16.BOSS直聘获取公司名称"
python selftest.py
python boss_tui.py --diagnose
```

已有同名分支时 `git switch refactor/boss-fetch-reliability` 后 `git pull --ff-only`。
诊断必须显示新构建标识和全部新模块的源码路径/SHA256。
**从新分支源码启动，不能继续使用旧免安装包**；打包时必须包含新增5个业务/基础模块。

## Windows实机验收

先测真实 Edge 建连：

```shell
python selftest.py --with-edge
python boss_tui.py --auto fetch --keyword "国内电商" --city "深圳" --pages 1 --format csv
```

默认自动模式遇验证立即结束，保留浏览器。预期退出码：

| 状态 | 退出码 | 验收含义 |
| --- | --- | --- |
| completed | 0 | 完全完成，核对本次paths和条数 |
| empty | 0 | 接口有效但零条，没有CSV，不算抓取成功验收 |
| partial | 2 | 有缺失/中途异常，已有数据保存 |
| blocked | 3 | 网站阻断或等待验证超时，未宣称成功 |
| failed | 1 | 程序/保存等错误，查看完整日志与检查点 |
| cancelled | 130 | 用户停止，已收到的数据保留 |

人工验证验收：

```shell
python boss_tui.py --auto fetch --keyword "国内电商" --city "深圳" --pages 1 --format csv --verification-timeout 300
```

遇验证时在原 Edge 页面正常处理，必要时手动搜索同关键词/城市。应不反复刷新、不自动关闭页面；验证完成且匹配响应有效才继续。
仍返回code37时如实记录阻断，不要持续重试，不要把离线测试通过当作网站放行。
TUI 配置默认验证等待300秒，可设0。日志页按 `s` 停止并保存，不退出界面；Ctrl+C停止保存后退出。

1页真实通过后再测2页、网站自然无更多结果、400页上限与中途停止。400是上限，不保证网站有400页。
也可显式运行 `python selftest.py --with-real-fetch`；该项要求真实非空且公司全称齐全，结果保留在job-result/verification_*，缺失或阻断会失败而非跳过。

## 检查点恢复

检查点在输出目录 `checkpoints/boss_checkpoint_*.jsonl`，每个任务独立。
默认结果目录：用户目录下 `.boss-zhipin-scraper/job-result`。
仅恢复已完整提交的页，断电留下的最后半行可以丢弃，中间损坏必须报错。

```shell
python boss_cdp.py recover "检查点文件完整路径.jsonl" --format both
```

这是离线导出，不访问网站，不自动续爬或重放未知页码。发生系统崩溃时尚未提交的当前页仍可能丢失；正常停止/异常路径会保存已收到的当前页列表。

## 回传

在新PR回传：分支提交SHA、完整测试摘要、诊断构建标识、实机命令/退出码、新生成CSV与状态清单核对结果，以及脱敏日志。
不要上传Cookie、会话参数、验证码、浏览器Profile或个人账号数据；日志路径中用户名也可脱敏。
用户确认后再决定是否合并，禁止自动合并。

## 实现参考

- Python官方 contextlib 文档说明 redirect_stdout 对 sys.stdout 有全局影响，不适合多数多线程场景： https://docs.python.org/3/library/contextlib.html#contextlib.redirect_stdout
- CDP Network 官方协议，loadingFinished 与 getResponseBody： https://chromedevtools.github.io/devtools-protocol/tot/Network/
