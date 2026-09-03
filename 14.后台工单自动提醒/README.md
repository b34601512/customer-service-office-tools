# 后台工单自动提醒（14号）

## 作者与版权

作者：黎路遥 ｜ 微信：luyao2089 ｜ 话术精灵官网：luyao2089.cc

版权所有 © 黎路遥，保留所有权利。本软件仅供学习交流，未经作者书面授权不得用于商业用途。

后台出现需处理的工单时自动提醒企业微信群：先支持京东两类店铺——京喜店「任务工单」（sale-jdm.jd.com）与 POP 店「交易纠纷」（shop.jd.com），多店铺各自独立登录态；店铺登录失效也会提醒。提醒附新增单**订单号**；纠纷**判责未出每 30 分钟重发（可配），判责出了即静默停止重发**。文案只留最少必要内容（无链接/时间/判责明细）。只@**当日值班售后**（组长在班@组长，其他人看金山排班表背景标记色）+ 主管。详见 `CLAUDE.md`、GitHub issue #623（元素采集）/#624（设计验收）/#631（值班@与底色）。

## 快速上手

1. `npm install`
2. 复制 `project-config/platform-config.example.json` 为 `platform-config.json`，填企微机器人与店铺。
3. 双击「启动工单提醒.bat」进菜单，或命令行：

```powershell
node src/cli/startCli.js login jd1          ; 首次为店铺登录一次（弹浏览器人工登录）
node src/cli/startCli.js once --dry-run     ; 巡检一轮，演练不发消息
node src/cli/startCli.js run                ; 常驻监控
node src/cli/startCli.js duty               ; 验证今日值班/底色/当前在班@名单
node src/cli/startCli.js test-notify        ; 验证企微链路
npm test
```
