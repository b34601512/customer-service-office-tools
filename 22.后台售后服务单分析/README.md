# 22. 后台售后服务单分析

## 角色（重要）
我（AI）是**管理层的检查秘书**：只去后台**检查**有没有漏处理的售后服务单，**汇报**给用户。
**不做**任何售后业务动作（不点同意、不退款、不回传、不发消息）。

## 目标
- 检查各平台后台是否存在**漏处理**的售后服务单；先做**天猫**，后期扩展到 4 大平台（每平台可多店铺）。
- 判"漏处理"的示例口径（用户 2026-09-18 给的第一个例子）：
  **退货服务单 = 客户货已退回，但没给客户退款**。
  核对办法：拿订单号去金山文档《2026年【湖南怀化售后】对接表》`https://www.kdocs.cn/l/ccj1mhG3wLy6`
  **只读**检索 —— 能搜到 → 说明这单被漏处理了。
- 其他类型的漏处理口径由**模型每次自己判断**，边跑边沉淀（这正是本项目的做法）。

## 设计原则（用户明确要求）
1. **不写死流程**：本项目不写"固定程序"，只沉淀
   - **可组合的底层工具**（`src/tools/`、`src/engine/`），单一职责、可被后面的 AI 自由组合；
   - **经验文档**（`经验/`），写清页面结构、字段含义、判漏规则、踩坑。
2. 检查频率低（不是每天跑），token 不是约束；**别为省 token 牺牲判断力**。
3. 实事求是：经验文档只写**实测到的事实**（带日期、URL、命令、应有 vs 实有），不写猜测。

## 红线
- **金山文档只读**：绝不改表格内容（不输入、不点保存、不触发同步）。
- 后台只做**读**操作；任何"提交/发送/同意/退款"类动作先停下来问用户。
- 需要人工登录/验证码/滑块：停下来叫用户，窗口留在可见状态。
- 失败按根目录《失败处置总方针》：不自动重试、先记现场到 `失败台账.md`，同一现象 ≥2 次才算规律。

## 目录
```
src/engine/       底层能力：浏览器拉起/附着、日志、配置读取
src/tools/        可组合小工具（CLI，单职责）
经验/             实战经验文档（页面结构/字段/判漏规则/踩坑）
project-config/   店铺清单与端口（stores.json）
runtime/          运行产物（不入库）：浏览器 profile、探针输出、日志
```

## 常用命令
```bash
# 探一页：打开/附着某个店铺的窗口，抓页面文本 + 抓 JSON 接口响应，落到 runtime/probe/
node src/tools/probe-page.js --platform tmall --store tmall1 --url "https://qn.taobao.com/home.htm/trade-platform/refund-list"

# 只附着已开着的窗口（不新开、不动登录态）
node src/tools/probe-page.js --platform tmall --store tmall1 --attach --seconds 20
```

## 现在处于什么阶段
见 `断点记录.md`（≤40 行）与 `经验/`。

## 与用户配合的约定（粘贴类，用户 2026-09-18 明确）

金山 AirScript 这类**只能由用户手动粘贴**的地方，不要再让用户自己打开文件复制——
**模型直接把文件内容塞进剪贴板**，用户只要「Ctrl+V」：

```bash
node src/tools/put-clipboard.js kdocs-scripts/AirScript-只读查询订单号.md --show
```

- 实现：PowerShell `[IO.File]::ReadAllText(path, UTF8)` → `Set-Clipboard`，并**回读校验长度**（防中文乱码、防截断）。
- **粘贴通道会吃掉等号序列**（实测：`===`→`=`、`==`→消失、`>=` 可能变 `>` 而静默漏数据）：
  交给用户粘贴的脚本里**不许出现等号比较**，由 `tests/airScriptPasteSafety.test.js` 锁死（`npm test`）。

## 工具台账（2026-09-18 沉淀，可直接复用）

| 用途 | 命令 | 备注 |
|---|---|---|
| 扫表取候选行 | `node src/tools/kdocs-filter.js --start-row 43000 --limit 3000 --out runtime/kdocs/x.json` | 走金山 AirScript 服务端只读；表尾才是最近记录 |
| 该 @ 谁 | `node src/tools/who-is-on-duty.js [--at 14:30] [--json]` | 排班表匿名只读；14:00 前李守耀优先/否则早班，14:00 后晚班 |
| 发企微群 | `node src/tools/send-wecom-notice.js --file <文本> --at 缪婷婷 [--send]` | **默认预演**；--send 才真发；≤2048 字节 |
| 每日一条命令 | `node scripts/dailyCheck.js [--days 7] [--send]` | 扫表→筛→去重→出清单→算通知对象；**默认不发** |
| 天猫后台概览（判漏快筛） | `node src/tools/tmall-refund-overview.js --store tmall1 [--probe-pending]` | 8 秒读出「24小时内待处理」等 10 项；**=0 即没有签收超 24h 未处理的单** |
| 天猫全部店铺一起扫 | `node scripts/checkTmallAllStores.js` | 遍历所有 tmall 店出汇总表（实测 3 店均无漏） |
| 天猫自动登录 | `node src/tools/tmall-login.js --store tmall2` | 账号密码运行时从 9号/12号 读；遇滑块/验证码停下叫人 |
| 天猫详情批量探针 | `node src/tools/tmall-refund-probe.js --store tmall1 --ids-file x.txt` | 每单新标签页（SPA 复用标签不响应，实测坑） |
| 京东售后+纠纷概览 | `node src/tools/jd-aftersale-overview.js --store jd1` | 即将超时/待处理=0 即无漏；纠纷列出待商家处理/执行的单及剩余时间 |
| 京东自动登录 | `node src/tools/jd-login.js --store jd1` | 凭据运行时读 12号/9号；登录按钮 `button.password__submit` |
| 拼多多售后概览 | `node src/tools/pdd-aftersale-overview.js --store pdd02` | 「24小时内将逾期订单数」=0 即无漏；投诉预警>0 要处理 |
| 拼多多自动登录 | `node src/tools/pdd-login.js --store pdd02` | 默认扫码页 → 先点「账号登录」；凭据读 22号→12号→9号 |
| 抖店售后概览 | `node src/tools/douyin-aftersale-overview.js --store douyin3` | 「临期待处理/投诉至监管/仲裁」全 0 即无临近超时 |
| 抖店登录 | 窗口开 `fxg.jinritemai.com/login/common`；手机号自动填（stores.json 的 loginPhone），用户只输验证码 | 别点 open.douyin.com 的 OAuth 授权 |
| 手动跑（双击） | `启动每日检查.bat` | 输出到 `runtime/logs/每日检查.log` |
| 定时跑 | Windows 计划任务 **「22号-售后退款每天检查」** 每天 09:10 执行 `定时检查.bat` | 2026-09-18 建，已试跑通过 |

**核心模块**（以后新需求直接复用，不要重写）：
- `src/features/refundCheck/refundCheckCore.js`：`selectPendingRefunds()` 口径（近 N 天 + 应退>0 + 状态不含已退款 + 按订单号去重）、
  `parseRecordDate()`（**同时认文本「2025/1/8」和 Excel 序列号 46247**）、`buildNoticeText()`。
- `src/engine/kdocsAirScript.js`：多脚本配置（`scripts.<名字>.webhookUrl`）+ token 回退。

**判据/踩坑记录**：见 `经验/反向检查-该退未退.md`（口径、列索引、重复行、日期形态）、`经验/金山对接表-只读读取.md`（脚本组织原则）。
