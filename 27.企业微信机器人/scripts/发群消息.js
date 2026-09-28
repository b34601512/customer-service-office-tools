#!/usr/bin/env node
/**
 * 27号 企微群机器人发送脚本（路线 A：群机器人 Webhook）
 *
 * 默认只预览、不发送；加 --send 才会真正发送。发送前请人工确认内容（仓库红线）。
 * 只尝试 1 次、不自动重试：避免重复消息，遵循仓库「失败不自动重试」铁律。
 *
 * 用法：
 *   node scripts/发群消息.js --text "内容" [--mention 手机号,手机号] [--type text|markdown]
 *   node scripts/发群消息.js --text-file 报告.txt --send
 *
 * Webhook 来源（二选一，推荐环境变量）：
 *   --webhook "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
 *   或环境变量 WECOM_WEBHOOK_URL
 */

const fs = require("fs");

const REQUEST_TIMEOUT_MS = 10000;
const WEBHOOK_HOST = "qyapi.weixin.qq.com";
const WEBHOOK_PATH = "/cgi-bin/webhook/send";

function parseArgs(argv) {
  const options = {
    text: "",
    textFile: "",
    mention: [],
    type: "text",
    webhook: "",
    send: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`参数 ${arg} 缺少取值`);
      return argv[i];
    };
    if (arg === "--text") options.text = next();
    else if (arg === "--text-file") options.textFile = next();
    else if (arg === "--mention") {
      options.mention = next().split(",").map((item) => item.trim()).filter(Boolean);
    } else if (arg === "--type") {
      options.type = next().trim().toLowerCase();
      if (!["text", "markdown"].includes(options.type)) throw new Error("--type 只支持 text 或 markdown");
    } else if (arg === "--webhook") options.webhook = next();
    else if (arg === "--send") options.send = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }

  return options;
}

function readContent(options) {
  if (options.text && options.textFile) throw new Error("--text 与 --text-file 只能二选一");
  if (options.textFile) return fs.readFileSync(options.textFile, "utf8").trim();
  return String(options.text || "").trim();
}

function resolveWebhook(options) {
  const url = String(options.webhook || process.env.WECOM_WEBHOOK_URL || "").trim();
  if (!url) throw new Error("缺少 webhook：请设置环境变量 WECOM_WEBHOOK_URL，或传 --webhook");
  return url;
}

function validateWebhook(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("webhook 不是合法 URL");
  }
  if (parsed.hostname !== WEBHOOK_HOST || !parsed.pathname.startsWith(WEBHOOK_PATH)) {
    throw new Error(`webhook 必须是 https://${WEBHOOK_HOST}${WEBHOOK_PATH}?key=... 形式，已拒绝发送`);
  }
  if (!parsed.searchParams.get("key")) throw new Error("webhook 缺少 key 参数");
  return parsed;
}

function maskWebhook(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has("key")) parsed.searchParams.set("key", "******");
    return parsed.toString();
  } catch {
    return "（非法 URL）";
  }
}

function buildPayload(options, content) {
  if (!String(content || "").trim()) throw new Error("消息内容为空，nothing to send");
  if (options.type === "markdown") {
    return { msgtype: "markdown", markdown: { content } };
  }
  const payload = { msgtype: "text", text: { content } };
  if (options.mention.length > 0) payload.text.mentioned_mobile_list = options.mention;
  return payload;
}

async function sendOnce(webhookUrl, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`响应不是合法 JSON（HTTP ${response.status}）：${bodyText.slice(0, 300)}`);
  }
  if (!response.ok || body.errcode !== 0) {
    const hint = body.errcode === 45009 ? "（触发 20 条/分钟限频，请等待后人工决定是否重发）" : "";
    throw new Error(`发送失败：HTTP ${response.status}，errcode=${body.errcode}，errmsg=${body.errmsg}${hint}`);
  }
  return body;
}

function usage() {
  console.log(`用法：
  node scripts/发群消息.js --text "内容" [--mention 手机号,手机号] [--type text|markdown]
  node scripts/发群消息.js --text-file 报告.txt --send

选项：
  --text          消息正文（与 --text-file 二选一）
  --text-file     从文件读正文（适合日报/报告）
  --mention       逗号分隔的手机号，仅 text 类型有效（企微按手机号 @人）
  --type          text（默认）或 markdown
  --webhook       群机器人地址；不传则读环境变量 WECOM_WEBHOOK_URL
  --send          真正发送；不传只预览（默认 dry-run）
  --help          显示本帮助`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  const content = readContent(options);
  const payload = buildPayload(options, content);
  const rawWebhook = resolveWebhook(options);
  validateWebhook(rawWebhook);

  console.log(`webhook: ${maskWebhook(rawWebhook)}`);
  console.log(`payload: ${JSON.stringify(payload, null, 2)}`);

  if (!options.send) {
    console.log("\n[dry-run] 未发送。确认内容无误后加 --send 真发。");
    return;
  }

  const result = await sendOnce(rawWebhook, payload);
  console.log(`\n[已发送] errcode=${result.errcode} errmsg=${result.errmsg}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[失败] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  readContent,
  resolveWebhook,
  validateWebhook,
  maskWebhook,
  buildPayload,
  sendOnce
};
