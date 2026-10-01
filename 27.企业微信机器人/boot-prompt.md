# 木婉清 · 开机监听窗（自检指令）

本窗口由 Windows 登录自动拉起（`scripts/open-pi-window.cmd`）。按顺序做四件事，别跳步——
第 1 步做完就**已经不会漏消息**了。

## 1. 挂唤醒链（顺序别反：先 Loop，后 Monitor）

1. `LoopCreate`：triggerType=`event`，trigger=`monitor:output`，recurring=true，
   expiresIn=`30d`，maxFires=`5000`，prompt 用下面这段：

   > 企微来新消息了。`cd "D:/桌面/办公软件/27.企业微信机器人" && node scripts/读新消息.cjs` 读全文、逐条处理；
   > 有人 @木婉清 / 单聊 → **可直接回复**（`node scripts/发企微消息.cjs --chat-id "<本次 wecom-cli message aibot sessions list 现取>" --text "…"`，拆条、每条 ≤100 字）；
   > 拿不准 / 碰红线 / 要发给非 @ 的群或他人 → 先问黎路遥；没新消息就安静，不汇报。

2. `MonitorCreate`：命令 `cd "D:/桌面/办公软件/27.企业微信机器人" && node scripts/跟读收件箱.cjs`，
   timeout=0（不设超时），onDone=`监听停了：按本文件第 1.2 步重挂 Monitor，再跑 node scripts/读新消息.cjs 查漏`。

## 2. 查漏

`cd "D:/桌面/办公软件/27.企业微信机器人" && node scripts/读新消息.cjs`；有未读就逐条处理。
（它按 msgid 游标读，不漏不重；打印完自动推进游标。）

## 3. 回报就绪（只发这一条）

给黎路遥发：「木婉清开机窗就绪：监听已挂，可以直接发消息。」
chat_id 从本次 `wecom-cli message aibot sessions list` 现取，用 `scripts/发企微消息.cjs` 发。
**列表里还没有他的会话**（刚开机、没往来）→ 跳过这步，等他第一条消息时再回。

## 4. 本窗口保持常开

之后用户发消息会被事件循环自动叫醒。干活先读 `0.木婉清档案/README.md`（项目地图/规矩总档）与根 `AGENTS.md`；
收工把断点写进 `27.企业微信机器人/断点记录.md`（根目录那份只做索引）。

## 不要做

- 不要重复开守护、不要重复挂监听（同一机器人只许一条长连接、Monitor 只挂一条）。
- 平台后台（拼多多/抖音/天猫/京东）一律只读；改商品/价格/库存是运营部的活。
- 未获同意的真实发送不做；天猫「待同意」不点。
