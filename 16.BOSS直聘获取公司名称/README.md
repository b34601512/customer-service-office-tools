# 16. BOSS直聘获取公司名称

依据仓库 [issue #636](https://github.com/b34601512/customer-service-office-tools/issues/636) 的完整踩坑经验实现的**可复用采集工具**。输入 `关键词 + 城市`，输出岗位的公司名、岗位、薪资、地区、链接（CSV/JSON）。

## 快速开始

> 首次使用：先双击 `安装依赖.bat` 装依赖，再双击 `启动BOSS采集.bat`（启动脚本也会自动检查缺失依赖）。

### 方式一：TUI 图形界面（推荐）

双击 **`启动BOSS采集.bat`**（自动检查/安装依赖、最大化窗口并进入 TUI），或手动：

```powershell
python boss_tui.py
```

↑↓ 选择菜单，←→ 切页，回车执行，Ctrl+C 直接退出（交互与「1.客服超时督办」控制台一致）。四个页面：

| 页 | 说明 |
|---|---|
| 1 总览 | 启动Chrome并登录 / 抓取职位数据 / 打开结果目录 / 退出 |
| 2 抓取 | 表单设置关键词、城市、页数、格式，回车开始抓取（运行中自动切到日志页） |
| 3 日志 | 最近一次任务运行输出与结果摘要 |
| 4 结果 | 最近生成的结果文件列表，回车打开目录 |

### 方式二：命令行

```powershell
pip install -r requirements.txt   # 首次装依赖
python boss_cdp.py setup          # 首次扫码登录
python boss_cdp.py fetch --keyword "国内电商" --city 深圳 --pages 2 --format csv
```

结果输出到 `C:\Users\<你>\.boss-zhipin-scraper\job-result\boss_jobs_*.csv/json`。
CSV 为 UTF-8 BOM，Excel 直接打开不乱码。

## 参数

| 命令 | 参数 | 说明 |
|---|---|---|
| `setup` | `--login-timeout` | 等待扫码秒数，默认 900 |
| `fetch` | `--keyword` | 必填，搜索关键词 |
| | `--city` | 城市（中文名或城市码均可，内置 24 个常用城市码） |
| | `--pages` | 页数，默认 1（BOSS 列表约限 10 页） |
| | `--format` | `csv` / `json` / `both`，默认 csv |
| | `--delay` | 每页间隔秒数，默认 3（低频防封） |

## 原理（为什么这么做）

- **不抓 DOM**：Selenium/Playwright 受控指纹明显，极易触发验证码。
- **直调页面内部 API** `wapi/zpgeek/search/joblist.json`：返回明文薪资 JSON，绕开前端字体反爬；签名/token 由已登录页面会话自动携带，程序零注入、零逆向。
- **独立 Chrome 实例**：独立 user-data-dir + CDP 端口 + 扫码登录一次，登录态永久保存在该 profile；之后 `fetch` 自动复用，**无需重复登录**。

## 已规避的踩坑（issue ⑥→工具对应）

| 踩坑 | 处理 |
|---|---|
| 不带登录态直调 API → `code:37 环境异常` | 只走已登录专用 Chrome，绝不裸调 API |
| 默认 profile 打不开调试端口 | 强制独立 `user-data-dir` + `--remote-allow-origins=*` |
| 复制 Cookie 免登录 → 127+ App-Bound 加密无解 | 不复制，仅扫码一次，profile 即持久登录态 |
| Windows 中文乱码 | 写入 `utf-8-sig`；控制台强制 utf-8 |
| 长命令被中断丢数据 | 分页增量：每页成功即入内存，结束时一次导出；失败页跳过不丢已抓数据 |

## 自动化测试（AI 无界面真实运行，SoftTalk #2705 原则）

程序已按「业务与界面分离」组织：TUI/CLI/AI 全部调用 `boss_cdp` 同一套业务真源，无测试旁路、无假路径。

```powershell
python selftest.py                  # 默认：业务逻辑 + 真实文件读写校验 + TUI 四页无头渲染 + 乱码自检
python selftest.py --with-chrome    # 追加：真实启动独立 Chrome 并探测 CDP/WebSocket 通路
python selftest.py --with-real-fetch # 追加：已登录则真实联网抓 1 页，校验真实导出文件
```

覆盖点：CSV 真实写盘带 UTF-8 BOM 并读回、JSON 结构、搜索 URL 编码、TUI 帧结构/版权/无乱码字节、按键分发、表单编辑、任务线程真实捕获 stdout、非 TTY 启动不阻塞；真实 Chrome/CDP 可选；真实联网抓取仅在已扫码登录时执行，未登录明确 SKIP 不造假。

## 业务规则与界面分离

- 业务真源：`boss_cdp.py`（`login_wait` / `fetch_page` / `parse_job` / `export_rows`）。
- 界面：CLI 入口 `boss_cdp.py` 与 TUI 入口 `boss_tui.py` 均调用同一业务真源 `boss_cdp`，无重复逻辑；其他脚本也可 `import boss_cdp` 复用。

## 合规提醒

BOSS 直聘《用户协议》禁止批量爬取；本工具定位**个人低频研究**（默认每秒 ≤1 请求），勿商用/高频，风险自负。

---

作者：黎路遥 ｜ 微信：luyao2089 ｜ 官网：luyao2089.cc
版权所有 © 黎路遥，保留所有权利