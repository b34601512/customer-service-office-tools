#!/usr/bin/env node
// 发企微群机器人消息（**默认只预演，不加 --send 绝不发送**）。
//
// ⚠ 2026-09-30 收拢：**发送逻辑只有一份** —— 27号 `src/企微通知.cjs`（唯一出处，22/24/25 号共用）。
//    本项目这个文件只是薄壳：把自己的「配置路径 + 日志」传进去。要改逻辑请改 27号 那份，别在这里另写。
//
// ⚠ 2026-09-30 用户口径：**群消息统一由「木婉清」（27号 aibot）发**：
//   cd 27.企业微信机器人 && node scripts/发企微消息.cjs --chat-id "<本次 sessions list 现取的群 chat_id>" --text "…"
//   木婉清不能真 @人（正文写名字）；**只有确实需要真 @ 时才回退到这个脚本**。
//
// 用法：
//   node src/tools/send-wecom-notice.js --file runtime/kdocs/待发消息.txt --at 王五            # 预演，只打印
//   node src/tools/send-wecom-notice.js --file runtime/kdocs/待发消息.txt --at 王五 --send     # 真发
//
// 说明：webhook 与人员手机号在 project-config/wecom-notify.json（不入库）；企微文本上限 2048 字节，超了报错不发送。
// ⚠ 正文里**不要手写 @某人**：--at 会通过 mentioned_mobile_list 让企微自己渲染 @，正文再写一个就重复成两个 @。
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");
const 共享 = require("../../../27.企业微信机器人/src/企微通知.cjs");

const CONFIG_FILE = projectPath("project-config", "wecom-notify.json");

async function main() {
  await 共享.跑命令行({ 配置路径: CONFIG_FILE, 项目根: projectPath(), 日志: log });
}

module.exports = {
  // 兼容旧名（原来这些都在本文件里实现；现在转发到共享核心）
  readConfig: () => 共享.读配置(CONFIG_FILE),
  resolveMentions: 共享.解析提及,
  parseArgs: 共享.解析参数,
  CONFIG_FILE,
};

if (require.main === module) {
  main().catch((error) => {
    log("企微通知", "失败", error.message);
    console.error(`\n  失败：${error.message}\n`);
    process.exit(1);
  });
}
