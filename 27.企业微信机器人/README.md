# 27.企业微信机器人（企业微信 × AI 接入手册）

一句话：**把企业微信接到你的 AI 上，让 AI 能查通讯录、读写文档/表格、约会议、发消息**。
本目录是给「客服主管 + 他的 AI」看的安装与使用说明；不保存任何真实 webhook / Bot Secret。

## 0. 官方入口

- 官方文档：<https://open.work.weixin.qq.com/help2/pc/21676>（《企业微信支持CLI开源》）→ 原文见 `经验/官方文档原文-清理版.md`
- 官方 CLI：<https://github.com/WecomTeam/wecom-cli>
- 官方 Skill：<https://github.com/WecomTeam/wecom-unified>

## 1. 最快的用法：把这句话丢给你的 AI

```
帮我安装 npx skills add WecomTeam/wecom-unified -y -g
```

AI 会自动：装 Skill → 装 `@wecom/cli` → 弹出二维码让你**扫码创建并授权一个「智能机器人」**。
⚠️ **扫码必须你本人做，AI 代替不了**；扫完之后让它跑体检：

```bash
node scripts/检查企微环境.js
```

期望全绿：Skill 已安装 / `wecom-cli 1.3.4` / `auth: authorized`（截图样例见 `经验/安装记录与实测.md`）。

## 2. 三条路线，先选对

| | A. 群机器人 Webhook | B. 官方 CLI + Skill | C. MCP |
|---|---|---|---|
| 是什么 | 群里「添加群机器人」给的 webhook 地址 | 企业微信官方 CLI（`wecom-cli`）+ Skill，扫码授权 | 把 B 的能力以 MCP 暴露给智能体 |
| 能干什么 | **只能往它所在的群发消息**（text/markdown/图片/文件），可按手机号 @人 | 发消息（授权人 / 最近有往来的会话）+ 通讯录/文档/在线表格/智能表格/智能文档/日程/会议/待办/微盘/邮件 | 同 B，取决于授权了哪些权限 |
| 授权 | 零授权（所以 **webhook 地址 = 密钥**） | 扫码一次；数据类权限可能需管理员审批/免审 | 需已建「API 模式机器人」，编辑页复制配置 |
| 适合 | 只做**通知/提醒** | 要 AI **查数据、读文档、发消息** | 已有 MCP 客户端的团队 |
| 本仓库例子 | 1/4/14/19/22/24/25 号的企微提醒 | 本项目（27号） | 同左 |

**一句话：只要提醒 → A；要 AI 动手查/写/发 → B；已有 MCP 平台 → C。**

## 3. 路线 B：终端安装（不想走对话时）

前提：Node.js（含 npm/npx）。

```bash
npm install -g @wecom/cli                    # 装 CLI（当前 1.3.4，需 >= 1.2.1）
npx skills add WeComTeam/wecom-cli -y -g     # 终端版 Skill（必需）
wecom-cli auth init                          # 出二维码，本人扫码（仅需一次）
wecom-cli auth show --status                 # authorized / unauthorized
```

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

## 6. 红线（本仓库 + 官方）

1. **扫码/验证码/短信必须本人做**：`wecom-cli auth init` 出码时停下来叫人，窗口留可见。
2. **任何真实发送前先问用户**（企微消息、邮件、文件回传一律先过目）；本目录脚本默认 dry-run。
3. **不在输出里暴露内部 ID**（官方硬约束，见 `经验/踩坑与红线.md`）。
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
| `auth show` 是 unauthorized | 本人扫码：`wecom-cli auth init` |
| 发消息提示目标不在最近会话 | 让该群/人先给机器人发一条消息；或直接发给授权人本人 |
| 路线 A 想 @ 特定人 | text 类型用 `--mention 手机号`；行内 @ 用 `<@userid>`（见 1号 `wecomTextMention.js`） |
| PromptScript 装失败 | 无害，换一个 AI 客户端或用上面终端方式 |
| 发送报 45009 | 触发 20 条/分钟限频，等人确认后再发，脚本不自动重试 |

## 10. 目录说明

```
27.企业微信机器人/
├── README.md                  ← 本文件（给主管的 AI 读）
├── 断点记录.md                 ← 下次开工先读
├── 经验/
│   ├── 官方文档原文-清理版.md     ← 官方《企业微信支持CLI开源》正文
│   ├── 安装记录与实测.md         ← 实测证据（路径/版本/扫描/测试结果）
│   └── 踩坑与红线.md            ← 必须问人的事 + 两路线各自的坑
├── scripts/
│   ├── 检查企微环境.js           ← 只读体检（node/skill/cli/auth/webhook）
│   └── 发群消息.js              ← 群机器人 webhook 发送，默认 dry-run
└── tests/                      ← `npm test`（11 项，含「不得自动重试」反向断言）
```
