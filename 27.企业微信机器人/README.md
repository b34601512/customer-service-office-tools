# 27.企业微信机器人（企业微信 × AI 接入手册）

一句话：**把企业微信接到你的 AI 上，让 AI 能查通讯录、读写文档/表格、约会议、发消息**。
本目录是给「客服主管 + 他的 AI」看的安装与使用说明；不保存任何真实 webhook / Bot Secret。

## ⚠️ 开源边界（先读）

本仓库开源；企微里的资源是公司私有。**webhook 地址、Bot ID/Secret、工单/客户数据、内部链接一律不入库**。
判定清单 → **`0.木婉清档案/企业微信能力与红线.md` §九** + 根 `开源边界.md`；提交前检查也在那。

## 0. 官方入口

- 官方文档：<https://open.work.weixin.qq.com/help2/pc/21676>（《企业微信支持CLI开源》）→ 原文见 `经验/官方文档原文-清理版.md`
- 如何获取 Bot ID 和 Secret：<https://open.work.weixin.qq.com/help2/pc/cat?doc_id=21677>（API 模式机器人 → 长连接）
- 官方 CLI：<https://github.com/WecomTeam/wecom-cli>
- 官方 Skill：<https://github.com/WecomTeam/wecom-unified>

## 1. 最快的用法：把这句话丢给你的 AI

```
帮我安装 npx skills add WecomTeam/wecom-unified -y -g
```

AI 会自动：装 Skill → 装 `@wecom/cli` → 弹出二维码让你**扫码创建并授权一个「智能机器人」**。
⚠️ **扫码必须你本人做，AI 代替不了**（二维码出不来就双击 `scripts/扫码授权.bat`）；扫完之后让它跑体检：

```bash
node scripts/检查企微环境.js
```

期望全绿：Skill 已安装 / `wecom-cli 1.3.4` / `auth: authorized`（截图样例见 `经验/安装记录与实测.md`）。

## 2. 三条路线，先选对

| | A. 群机器人 Webhook | B. 官方 CLI + Skill | C. MCP |
|---|---|---|---|
| 是什么 | 群里「添加群机器人」给的 webhook 地址 | 企业微信官方 CLI（`wecom-cli`）+ Skill，扫码授权 | 把 B 的能力以 MCP 暴露给智能体 |
| 能干什么 | **只能往它所在的群发消息**（text/markdown/图片/文件），可按手机号 @人 | 发消息（授权人 / 最近有往来的会话）+ 通讯录/文档/在线表格/智能表格/智能文档/日程/会议/待办/微盘/邮件 | 同 B，取决于授权了哪些权限 |
| 授权 | 零授权（所以 **webhook 地址 = 密钥**） | 两种任选：①扫码（官方推荐）②手动填 API 模式机器人的 Bot ID + Secret；数据类权限可能需管理员审批/免审 | 需已建「API 模式机器人」，编辑页复制配置 |
| 适合 | 只做**通知/提醒** | 要 AI **查数据、读文档、发消息** | 已有 MCP 客户端的团队 |
| 本仓库例子 | 1/4/14/19/22/24/25 号的企微提醒 | 本项目（27号） | 同左 |

**一句话：只要提醒 → A；要 AI 动手查/写/发 → B；已有 MCP 平台 → C。**

## 3. 路线 B：接入方式（**给其他主管：先看 3.1 扫码**）

前提：Node.js（含 npm/npx）。

```bash
npm install -g @wecom/cli                    # 装 CLI（当前 1.3.4，需 >= 1.2.1）
npx skills add WeComTeam/wecom-cli -y -g     # 终端版 Skill（必需）
```

### 3.1 扫码接入（✅ 默认推荐，所有人都能懂）

只需一步：**双击 `scripts/扫码授权.bat`**（或在终端跑 `wecom-cli auth init`）→ 屏幕出现二维码 →
用手机企业微信扫一下 → 按提示确认 → 看到 `authorized` 就完成（二维码 5 分钟内有效）。
扫码会自动完成「创建机器人 + 授权」，不需要懂后台、不需要填任何 ID。

```bash
wecom-cli auth init                          # 出二维码，本人扫（等价于双击上面的 bat）
wecom-cli auth show --status                 # authorized / unauthorized
```

> 扫码识别不了屏幕上的二维码时，让 AI 跑：`wecom-cli auth init --noninteractive --output-qrcode 二维码.png`，扫生成的图片。

### 3.2 手动接入（进阶：不想扫码 / 机器人要复用给 MCP、API）

先在企业微信客户端里创建并拿到 Bot ID + Secret（官方文档 21677）：
1. 工作台 → **智能机器人** → 创建机器人 → **手动创建**；
2. 选择 **API 模式创建**；
3. API 配置页 → 连接方式选「**使用长连接**」；
4. 页面自动生成并展示 **Bot ID** 和 **Secret**，复制保存；
5. 补充机器人**可见范围**，其余保持默认，直接保存（API 模式不支持预览/调试）。

然后双击 `scripts/手动授权.bat`（真实控制台窗口输入 Bot ID、Secret，密文不回显、不进聊天记录）；
或在任意终端窗口自己跑：

```bash
wecom-cli auth init --manual                 # 真实终端里交互输入 Bot ID + Secret
wecom-cli auth show --status
```

> 坑：`--manual` **必须真实终端**。在 AI 的管道/重定向环境里跑会报 `893001 手动输入需要终端`，用 `.bat` 或自己开终端。

装成功的样子、安全扫描结果、已知无害报错（PromptScript）：`经验/安装记录与实测.md`。

## 4. 装上以后能干什么

| 业务域 | 命令前缀 | 客服场景 |
|---|---|---|
| 消息 | `wecom-cli message aibot ...` | 把检查结果发到主管/客服的单聊或群 |
| 通讯录 | `wecom-cli contact ...` | 按姓名找人（发消息前解析人） |
| 文档/表格 | `wecom-cli doc / sheet / smartsheet / smartpage ...` | 沉淀日报、写在线表、读表格数据 |
| 日程/会议 | `wecom-cli calendar / meeting ...` | 约复盘会、查忙闲 |
| 待办 | `wecom-cli todo ...` | 给责任客服派单、盯截止 |
| 微盘/邮件/媒体 | `wecom-cli disk / email / media ...` | 存报告、发邮件、传文件 |
| 我是谁 | `wecom-cli identity whoami` | 拿授权人身份（给授权人发消息可直接用） |

**参数别猜**：Skill 装好后，让 AI 先读 `~/.agents/skills/wecom-unified/references/wecomcli-*.md` 对应那一份，再拼命令。

## 5. 发消息的硬限制（官方规定，别绕）

- 只能发给：**授权人本人**，或**机器人最近有消息往来的会话**（`message aibot sessions list` 返回的列表）。
- 目标必须从**本次** `sessions list` 里原样取；不能用手打的 ID、历史 chat_id、通讯录 userid。
- 发图片/文件/语音/视频：先用 `media` 域把本地文件换成 media_id，再发。
- 输出里**不许出现** userid / chat_id / mail_id 等内部 ID（用姓名、群名、主题、时间代替）。

**发消息的稳妥写法（2026-09-29 踩坑后固化）**
1. 先 `wecom-cli message aibot sessions list` 取**本次**会话里的 `chat_id`（不要用手打的）。
2. **用脚本发，别手拼 JSON**：`node scripts/发企微消息.cjs --chat-id "<本次的id>" --file 正文.md`
   - **汇总只私发黎路遥本人（2026-10-01 他拍板：不要发到客户群/金牌组）**：群 chat_id（`wr` 开头）**默认拒发**（exit 1）；确需发群得显式 `--允许发群`，且先问他。
   - 它把正文包成 `{"chat_id":…,"msg_type":"markdown","markdown":{"content":"<字符串>"}}` 再调 CLI，并在 `success!=true` 时报错退出；单测 `node --test tests/发企微消息.test.js`。
   - **`--markdown` 收的是「markdown 内容对象」本身**（`{"content":"…"}`），不是整包请求体（`chat_id`+`msg_type`+`markdown`）；整包只在 `--json` 里用。传错时 CLI 会**打印 help 并 exit=2**，别误以为参数没写全（2026-09-29 实例，脚本已修 + 单测锁死）。
   - **正文必须是字符串**：给 `content` 传数组会报 `10003 'content' 类型不匹配，应为字符串`（单元素数组偶尔被 CLI 的 json repair 改成字符串，于是“有时成功有时失败”——2026-09-29 实例：连着几条长汇报静默失败）。
   - 别在正文 JSON 里塞裸双引号（用「」）；**临时文件别放 `/tmp`**：Node 写的 `/tmp` 是 `C:\tmp`，bash 的 `/tmp` 是 MSYS 临时目录 → 读不到（实例：`cat: /tmp/md.json: No such file`）。
3. 整包 `--json '{...}'` 容易被 CLI 的 json repair 改坏 → 报 `40073 非法的 chat_id`（其实是 JSON 坏了，不是 id 坏了）。
4. **读 offset 的顺序**：处理完消息要先把 `inbox.read-offset` 写成「本次读到的那个位置」，**再**发回复；若先发回复再按文件长度写 offset，会把等待期间新到的消息一起跳过（2026-09-29 实例：13:39 用户发的"自定义风格绑 DEDAKJ"被跳过近 1 小时）。

## 6. 红线（本仓库 + 官方）

1. **扫码/验证码/短信必须本人做**：`wecom-cli auth init` 出码时停下来叫人，窗口留可见。
2. **任何真实发送前先问用户**（企微消息、邮件、文件回传一律先过目）；本目录脚本默认 dry-run。
3. **不在输出里暴露内部 ID**（官方硬约束，见 `0.木婉清档案/企业微信能力与红线.md` §四）。
4. **数据类权限可能触发企业审批**；免审名单在：管理后台 → 安全与管理 → 管理工具 → 智能机器人 → 管理。
5. **先测试企业/小范围验证**再用到生产（官方风险提示：模型幻觉可能导致数据泄露、越权）。
6. **webhook 地址、Bot Secret 不进 Git**；真凭证只放本机。

## 7. 从零到一条通知（路线 A，不装任何东西，5 分钟）

1. 目标企微群右上角「⋯」→「群机器人」→「添加机器人」→ 复制 Webhook 地址。
2. 本机设环境变量 `WECOM_WEBHOOK_URL`（或传 `--webhook`），**别写进仓库**。
3. 先预览、再真发：

```bash
node scripts/发群消息.js --text "测试：客服日报已生成" --mention 13800000000          # dry-run 预览
node scripts/发群消息.js --text "测试：客服日报已生成" --mention 13800000000 --send   # 人工确认后真发
```

> 群机器人官方参数文档（给 AI 查）：<https://developer.work.weixin.qq.com/document/path/91770>

> ⚠ **2026-09-30 用户拍板：群消息不再走群机器人 webhook，统一由木婉清（本机器人）发** ——
> `node scripts/发企微消息.cjs --chat-id "<本次 sessions list 现取的群 chat_id>" --text "…"`（默认群「金牌组」；**仅限他明确要发的场合**——日常汇报一律私发他；群 id 要加 `--允许发群`）。
> 木婉清的消息**不能真 @人**，把名字写进正文即可（已拍板 OK）；**要真 @ 就用群机器人 webhook —— 两个机器人各管一段，都有用**（用户 2026-09-30）。
> **群内被 @ 要回在群里、且开头 @ 回提问人**（黎路遥 2026-10-05）：正文写「@名字 …」；提问人从消息 `fromUserId` 对名字（例：`wo******************************`=李某某，`woFqtuEQAA25eR-eNXTC4bQoUip-VCiQ`=黎路遥）。

## 8. 客服主管的 3 个现成用法

- **日报/异常推送**：各项目跑出的结果文本 → `发群消息.js`（路线 A）或 `message aibot send`（路线 B）发到主管群/客服群。
- **AI 直接读表**：日报写进在线表格/智能表格，让 AI 每周自动汇总（`sheet`/`smartsheet` 域）。
- **会议+待办闭环**：AI 发现异常 → 建待办派给责任人 → 约复盘会议（`todo`/`calendar` 域）。

本仓库已在发企微的项目可直接对照：`1.客服超时督办/src/integrations/wecomRobot.js`（webhook 文本 + @）、`14/19/22/24/25号` 的提醒模块。

## 9. 常见问题

| 问题 | 处理 |
|---|---|
| Skill/CLI 装没装？ | `node scripts/检查企微环境.js` |
| `wecom-cli` 不存在或版本 < 1.2.1 | `npm install -g @wecom/cli` |
| `auth show` 是 unauthorized | 推荐扫码：双击 `scripts/扫码授权.bat`（或终端跑 `wecom-cli auth init`） |
| 我不懂命令行怎么办？ | **只做一件事：双击 `scripts/扫码授权.bat` 并用企业微信扫码**；其余交给你的 AI |
| 不想扫码 / 机器人要给多个工具复用 | 用 API 模式机器人（官方 21677），拿 Bot ID + Secret 走手动接入（见 §3.2） |
| `--manual` 报「手动输入需要终端」 | 必须在真实终端窗口运行；用 `scripts/手动授权.bat`，AI 的管道环境不行 |
| 发消息提示目标不在最近会话 | 让该群/人先给机器人发一条消息；或直接发给授权人本人 |
| 路线 A 想 @ 特定人 | text 类型用 `--mention 手机号`；行内 @ 用 `<@userid>`（见 1号 `wecomTextMention.js`） |
| PromptScript 装失败 | 无害，换一个 AI 客户端或用上面终端方式 |
| 发送报 45009 | 触发 20 条/分钟限频，等人确认后再发，脚本不自动重试 |
| 想验 webhook key 还有没有效 | **探活没用**：非法 msgtype 一律返回 40058（连假 key 也一样，2026-09-30 实测）；只有「合法 payload 真发一条」才能看出 93000（key 无效）。所以验 key = 往群里发条最小消息，**先问用户** |
| 金牌组提醒机器人被删/重建了 | webhook 会换 key：`14/22/24/25号` 的本地 `project-config/*.json` 里有同一串 key，**要一起换**（2026-09-30 实测 4 处） |
| 自动化到底往哪几个群发？ | 共 3 个：**金牌组**（14/22/24/25号，key 已于 2026-09-30 换新）、**1号「小程序商城&客服对接群」**（key 9b06404e）、**19号 的群**（配置里未写群名，key 922b0684）；后两个 2026-09-30 经用户确认**机器人都还在、不用补** |

## 10. 目录说明

```
27.企业微信机器人/
├── README.md                  ← 本文件（给主管的 AI 读）
├── 断点记录.md                 ← 下次开工先读
├── 经验/
│   ├── 官方文档原文-清理版.md     ← 官方《企业微信支持CLI开源》正文
│   ├── 安装记录与实测.md         ← 实测证据（路径/版本/扫描/测试结果）
│   ├── 踩坑与红线.md            ← 已收拢到档案（这里只是指路）
│   └── 开源边界-私有与通用.md     ← 已收拢到档案（这里只是指路）
├── src/
│   ├── inbox.js                ← 消息帧 → 收件记录（纯函数，可单测）
│   └── 企微通知.cjs             ← ★共享核心：21 号项目的 webhook 通知最终都走这里（22/24/25 号只是薄壳）
├── scripts/
│   ├── 检查企微环境.js           ← 只读体检（node/skill/cli/auth/webhook）
│   ├── 发群消息.js              ← 群机器人 webhook 发送，默认 dry-run（逻辑唯一出处：src/企微通知.cjs）
│   ├── 扫码授权.bat             ← ★新手走这个：双击+手机扫码，完成创建与授权
│   ├── 手动授权.bat             ← 进阶：API 模式机器人，输入 Bot ID+Secret
│   ├── 导出机器人凭据.js         ← 从 wecom-cli 本机凭据库导出 Bot ID+Secret（长连接用，不入库）
│   ├── 长连接守护.js            ← ★官方 SDK 长连接：只收不回，落 .state/inbox.jsonl
│   └── 启动长连接守护.bat        ← 双击启动长连接守护
└── tests/                      ← `npm test`（19 项，含「不得自动重试」反向断言）
```

## 11. 长连接守护（官方 SDK，用来「读消息」）
> 为什么必须走它：官方 CLI 的会话接口只给「会话名 + 最后消息时间」，**读不到正文**；
> 要读正文只能用官方长连接（教程 #72：`aibot_subscribe` 订阅 → `aibot_msg_callback` 收 → `aibot_respond_msg` 回）。

- **依赖**：`@wecom/aibot-node-sdk`（WecomTeam 官方）；连接地址 `wss://openws.work.weixin.qq.com`。
- **凭据**：`node scripts/导出机器人凭据.js` 从 wecom-cli 本机凭据库导出到
  `project-config/aibot-credentials.local.json`（已 gitignore，绝不入库）。
- **启动**：`npm run 守护` 或双击 `scripts/启动长连接守护.bat`；**自检**：`npm run 守护:自检`（只验证认证+订阅，成功即退出）。
- **行为**：收到消息/事件 → 追加到 `.state/inbox.jsonl`（一行一条：时间、单聊/群聊、发送者、类型、正文/附件备注）；
  图片/文件/语音/视频会**自动解密另存到 `.state/media/`**（文件名写在记录的 `mediaPath`，SDK `downloadFile(url,aeskey)`）。
  **只收不回**——任何真实回复/发送都必须先经用户同意（业务红线）。
- **断线留痕**：全量日志建议落 `.state/daemon.log`（`node scripts/长连接守护.js 2>&1 | tee -a .state/daemon.log`）；
  SDK 会写 `WebSocket connection closed: <code> <reason>` 或 `Received disconnected_event...`（后者＝被新连接顶掉），便于事后定论。
- **限制**：官方规定每个机器人同一时间只允许一条有效长连接（新连接会把旧的顶掉）；不要同时开多个守护。
- **验证**：连上打印「长连接认证并订阅成功」；别人给机器人发消息后，`.state/inbox.jsonl` 会实时多一行。

## 12. 写售后工单（脚本）

- `node scripts/写售后待办.cjs --content "要做的事" [--owner auto] [--deadline "2026-09-30 00:00:00"] [--priority 一般] [--dry-run]`
- 目标表：企微智能表格『**金牌组待办清单**』的子表『**售后待办清单**』（**docid 是公司私有数据、不打进仓库**：本机存 `project-config/售后待办.local.json`，工具 `scripts/写售后待办.cjs` 会自己读；sheet `q979lj`）。
  **「金牌组」＝售后团队**（用户/经理 2026-09-29 确认）。
- `--owner auto` = 问 **28号项目**（`28.排班与派活/src/tools/今天谁值班.cjs`）：读金山排班表**底色＋此时此刻在班**判断值班售后（**组长在班＝组长负责**，售后组长＝李某某；不是看早/晚文字；口径与名单都在 28号，本项目不再自带）；
  **读不到/分不清值班人就报错停下**，不许猜。写完自动回读。
- 单测：`node --test tests/写售后待办.test.js`（含一条**反向锁**：27号 里不许再出现值班名单/排班表链接）。
- 相关：任何真实客服动作（退款/改发货）由售后本人执行；木婉清只写清楚工单。
- **售后做完了帮她打钩**（用户 2026-09-30）：`wecom-cli smartsheet records update --json '{"docid":"<本机配置里的 docid>","sheet_title":"售后待办清单","records":[{"record_id":"<行ID>","values":{"是否完成":true}}]}'`（一次把要勾的行拼成一个请求；勾完必须回读确认）。
  行 ID 用 `records list` 按订单号搜出来；“售后已完成”的判据＝后台备注里已有实质动作（如「已通知拦截」「已发起协商」），单子还没结案（等买家/平台）也算完成。

## 开机自启（无窗口）—— 2026-10-01 由「赵敏」帮装

```
Windows「启动」文件夹 木婉清-企微守护.lnk
  → wscript.exe ...\scripts\静默启动.vbs      （纯 ASCII，不能写中文）
    → node scripts\daemon_entry.cjs           （ASCII 入场：防重复 + 落日志）
      → node scripts\长连接守护.js            （本体：只收不回，照旧）
```

- **防重复**：`daemon_entry.cjs` 先读 `.state/daemon.pid`，发现已有守护在跑就跳过
  —— 同一个机器人只允许一条长连接，重复开会把旧的顶掉、漏消息。
- **日志**：无窗口运行看不到控制台 → 输出落 `.state/daemon.log`（超 2 MB 自动清空）。
- 手动起（会开黑窗）：`scripts\启动长连接守护.bat`；自检：`node scripts\长连接守护.js --check`。
- 装法（换机器时照做）：双击 `scripts\静默启动.vbs` 跑一次，再给「启动」文件夹建个指向它的快捷方式。

## 开机监听窗（自动挂监听）—— 2026-10-01 照「赵敏」那套装

```
Windows「启动」文件夹 木婉清-开机开窗.lnk
  → 27.企业微信机器人\scripts\open-pi-window.cmd   （纯 ASCII，路径走 %~dp0）
    → 在仓库根 D:\桌面\办公软件 起 pi，首条指令 = @27.企业微信机器人\boot-prompt.md
      → 窗口自己：LoopCreate（事件 monitor:output）+ MonitorCreate（跟读收件箱.cjs）
        → 有新消息就被叫醒、按 boot-prompt.md 处理
```

- **跟读收件箱**：`node scripts/跟读收件箱.cjs` 挂在 Monitor 上常驻（1.5 秒看一次文件增量，有新行才打印）；
  打印即触发 `monitor:output` 事件唤醒 AI。只打「时间/单聊群聊/类型/摘要」，**不带内部 ID**；半行等补全、文件轮转自愈。
- **装/看/卸开机窗**：`node scripts/装开机窗.cjs` / `--看` / `--卸载`（装完自动回读校验目标路径）。
- **测链路**（不动真实收件箱）：`node scripts/跟读收件箱.cjs --文件 <临时 jsonl>`，往那个文件追加一行看有没有打摘要。
- 单测：`node --test tests/跟读收件箱.test.js`（摘要无内部 ID + 半行/轮转）。
- 注意：「守护（收）」+「开窗（醒）」是两条链，都放 Windows「启动」文件夹；换机器后两个都要装。
- **机器人消息授权 7 天到期**（黎路遥 2026-10-05 确认，后台不可改）：到期后 `发企微消息.cjs` 报 `850003「消息使用权限已过期」`，**收消息不受影响**；处置＝用 **22号金牌组 webhook** 通知黎路遥重新授权（命令与链接见根 `失败台账.md` 2026-10-05 条），授权后补发未送达的消息、并在群里致谢收尾。
