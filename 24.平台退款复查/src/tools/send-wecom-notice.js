#!/usr/bin/env node
// 发企微群机器人消息（**默认只预演，不加 --send 绝不发送**）。
//
// 用法：
//   node src/tools/send-wecom-notice.js --file runtime/kdocs/待发消息.txt --at 缪婷婷            # 预演，只打印
//   node src/tools/send-wecom-notice.js --file runtime/kdocs/待发消息.txt --at 缪婷婷 --send     # 真发
//
// 说明：webhook 与人员手机号在 project-config/wecom-notify.json（不入库）；
//       企微文本消息上限 2048 字节，超了直接报错不发送。
const fs = require("fs");
const path = require("path");
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const CONFIG_FILE = projectPath("project-config", "wecom-notify.json");
const TEXT_BYTE_LIMIT = 2048;

function parseArgs(argv) {
  const args = { at: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--file") { args.file = argv[index + 1]; index += 1; continue; }
    if (token === "--text") { args.text = argv[index + 1]; index += 1; continue; }
    if (token === "--at") {
      while (argv[index + 1] && !argv[index + 1].startsWith("--")) { args.at.push(argv[index + 1]); index += 1; }
      continue;
    }
    if (token === "--send") { args.send = true; }
  }
  return args;
}

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) throw new Error(`缺少通知配置：${path.relative(projectPath(), CONFIG_FILE)}`);
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  if (!config.webhookUrl) throw new Error("配置里没有 webhookUrl");
  return config;
}

function resolveMentions(names, config) {
  return names.map((name) => {
    const mobile = (config.members || {})[name];
    if (!mobile) throw new Error(`配置的 members 里没有「${name}」的手机号，无法 @ 他`);
    return mobile;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readConfig();
  const text = args.text !== undefined ? args.text : (args.file ? fs.readFileSync(projectPath(args.file), "utf8") : "");
  if (!text.trim()) throw new Error("没有消息内容（用 --file 或 --text 传）");
  const mentionedMobileList = resolveMentions(args.at, config);
  const bytes = Buffer.byteLength(text, "utf8");
  const lines = text.split(/\r?\n/).length;
  log("企微通知", args.send ? "准备发送" : "预演", `${lines} 行 / ${bytes} 字节`, args.at.length ? `@${args.at.join("、")}` : "不@任何人");
  if (bytes > TEXT_BYTE_LIMIT) throw new Error(`消息 ${bytes} 字节，超过企微上限 ${TEXT_BYTE_LIMIT}，请精简或拆条`);

  if (!args.send) {
    console.log("\n----- 以下是将要发送的内容（预演，未发送）-----");
    console.log(text);
    console.log("----- 预演结束：加 --send 才会真发 -----\n");
    return;
  }

  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: text, mentioned_mobile_list: mentionedMobileList } })
  });
  const result = await response.json();
  if (result.errcode !== 0) throw new Error(`企微返回 errcode=${result.errcode} errmsg=${result.errmsg}`);
  log("企微通知", "发送成功", `errcode=0`, `@${args.at.join("、")}（${mentionedMobileList.join(",")}）`);
  console.log(`\n  ✓ 已发送到企微群（errcode=0），@${args.at.join("、")}\n`);
}

module.exports = { readConfig, resolveMentions };

if (require.main === module) {
  main().catch((error) => {
    log("企微通知", "失败", error.message);
    console.error(`\n  失败：${error.message}\n`);
    process.exit(1);
  });
}
