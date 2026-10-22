# 工具/群消息 · 群机器人 webhook（真 @ 用）

**用途**：机器人自己的消息在群里 @ 不出人，需要**真 @**（点名手机号/userid）时走这里。

## 文件

| 文件 | 说明 |
|---|---|
| `发群消息.js` | 命令行入口（薄壳） |
| `企微通知.cjs` | 真正的逻辑（预览/发送/校验/限频提示） |
| `群机器人.local.json` | 群机器人 webhook（**只留本机、不入库**，`.gitignore` 已按 `**/*.local.json` 覆盖） |

## 用法（默认只预览，加 `--send` 才发）

```bash
cd "D:/桌面/木婉清/工具/群消息"
# webhook 走环境变量或 --webhook 二选一
node 发群消息.js --text "内容" --mention-user <userid> [--webhook "..."]        # 预览
node 发群消息.js --text "内容" --mention-user <userid> --send                   # 真发
```

- 只尝试 1 次、**不自动重试**（避免重复消息，遵守「失败不自动重试」铁律）。
- 发送前必须人工确认内容（仓库红线）。

## 来历（2026-10-21）

原来在 `27.企业微信机器人/`（企微旧套件），旧套件整包退役到 `D:\备份文件夹\2026-10-21-木婉清企微旧套件\` 之后只剩备份那份——**清备份就断，而且断得没声音**（排班派活专员·焦宛儿提的）。
现在搬到这儿：配置 `群机器人.local.json`、脚本 `发群消息.js` + `企微通知.cjs` 同目录，`require` 已从 `../src/` 改成本目录。

## 别搞混

日常收发消息**不走这个 webhook**，走 `工具/企微/`：`读收件箱.mjs`（收）/ `直连.mjs --to N|--到人`（发）。
webhook 只用于「必须在群里真 @ 到人」这一种场景。

## 群里要真 @ 人时（2026-10-21 老板当场要求）

老板 2026-10-21 17:02 在售后组里点出：「你回答问题怎么不@对应的人啊。」

原因：`工具/企微` 走的 aibot 接口（`message.send`）**没有 mention 字段**，只能把名字写在正文里，@ 不出来。要真 @ 必须用本目录的**群机器人 webhook**（`mentioned_list` 收 userid）。

分工（定死）：
- **需要点人**（派活、让某人确认、催某人）→ 群机器人 webhook，`mentioned_list:[<userid>]`
- **不需要点人**的通报 → 仍走 `工具/企微/直连.mjs --to <群编号>`（aibot），免得每条都从「售后组提醒机器人」发出、看着乱

最小用法（实战验证 2026-10-21，errcode 0）：

```bash
cd "D:/桌面/木婉清/工具/群消息"
node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync('群机器人.local.json','utf8'));
const body=JSON.stringify({msgtype:'text',text:{content:'@陈某某 …正文…',mentioned_list:['woFqtuEQAAAavuSNo5VTWAf2TXPRLOWQ']}});
fetch(j.webhookUrl,{method:'POST',headers:{'content-type':'application/json'},body}).then(r=>r.text()).then(console.log);
"
```

群 id 对照（售后组 `wrFqtuEQAA328pVY-8VtQdfmDtzEE-OQ`）只用于 aibot 那条路；webhook 本身已绑群，不用传群 id。
