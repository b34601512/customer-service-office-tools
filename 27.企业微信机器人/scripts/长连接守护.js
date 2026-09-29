#!/usr/bin/env node
// 企业微信智能机器人「长连接守护」——官方 SDK（@wecom/aibot-node-sdk）+ 官方长连接协议（教程 #72）。
//
// 作用：常驻订阅机器人，把收到的消息/事件原样落到本机 `.state/inbox.jsonl`（JSONL，一行一条），
//      供 AI/人读取；**只读不回复**——任何真实回复/发送都必须先经用户同意（业务红线）。
//
// 用法：
//   node scripts/长连接守护.js            # 常驻（Ctrl+C 退出）
//   node scripts/长连接守护.js --check    # 自检：只验证「能连上并订阅成功」，成功即退出
//   node scripts/长连接守护.js --dump     # 连上后把收到的每条消息直接打印到终端（调试用），仍不回复
//
// 凭据：本机 `project-config/aibot-credentials.local.json`（用 scripts/导出机器人凭据.js 生成，已 gitignore）。
// 注意：官方限制「每个机器人同一时间只能有一条有效长连接」，不要同时开多个本脚本。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const CRED_PATH = path.join(ROOT, "project-config", "aibot-credentials.local.json");
const STATE_DIR = path.join(ROOT, ".state");
const INBOX_PATH = path.join(STATE_DIR, "inbox.jsonl");
const PID_PATH = path.join(STATE_DIR, "daemon.pid");

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const DUMP = args.has("--dump");

function log(msg) {
  const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${t}] ${msg}`);
}

function loadCredentials() {
  const raw = fs.readFileSync(CRED_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.botId || !parsed.secret) throw new Error("凭据文件缺少 botId / secret");
  return parsed;
}

function appendRecord(record) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.appendFileSync(INBOX_PATH, JSON.stringify(record) + "\n", "utf8");
}

const seenMsgIds = new Set(); // 排重（SDK 官方建议按 msgid 排重）
const MAX_SEEN = 5000;
let wsClient = null; // 由 main() 注入，用于媒体解密下载

/** 图片/文件/语音/视频消息：用 SDK 的 downloadFile(url, aeskey) 解密后落到 .state/media/。 */
async function saveMedia(record) {
  const media = record.media;
  if (!media || !media.url || !wsClient) return;
  try {
    const { mediaFileName } = require("../src/inbox");
    const { buffer, filename } = await wsClient.downloadFile(media.url, media.aeskey);
    const dir = path.join(STATE_DIR, "media");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, filename || mediaFileName(record.msgid, media));
    fs.writeFileSync(file, buffer);
    record.mediaPath = file;
    record.mediaBytes = buffer.length;
  } catch (error) {
    log("媒体下载失败：" + (error && error.message ? error.message : String(error)));
  }
}

async function handleFrame(kind, frame) {
  let buildRecord;
  try {
    ({ buildRecord } = require("../src/inbox"));
  } catch (error) {
    log("内部错误：找不到 src/inbox.js —— " + error.message);
    return;
  }
  const record = buildRecord(frame);
  record.kind = kind;
  if (record.msgid) {
    if (seenMsgIds.has(record.msgid)) return; // 重复帧直接跳过
    seenMsgIds.add(record.msgid);
    if (seenMsgIds.size > MAX_SEEN) {
      const first = seenMsgIds.values().next().value;
      seenMsgIds.delete(first);
    }
  }
  await saveMedia(record);
  appendRecord(record);
  const who = record.chattype === "group" ? "群聊" : "单聊";
  const text = (record.text || record.note || "").replace(/\s+/g, " ").slice(0, 80);
  const saved = record.mediaPath ? "（已存 " + path.basename(record.mediaPath) + "）" : "";
  if (DUMP) console.log(JSON.stringify(record, null, 2));
  else log(`收到${who}消息 [${record.msgtype}]${saved} ${text}`);
}

async function main() {
  let sdk;
  try {
    sdk = require("@wecom/aibot-node-sdk");
  } catch (error) {
    console.error("缺少依赖：先在本目录执行 `npm install @wecom/aibot-node-sdk`");
    process.exitCode = 1;
    return;
  }
  let creds;
  try {
    creds = loadCredentials();
  } catch (error) {
    console.error("读取凭据失败：" + error.message);
    console.error("先在 27号 跑 `node scripts/导出机器人凭据.js`（依赖已授权的 wecom-cli）。");
    process.exitCode = 1;
    return;
  }

  const AiBot = sdk.default || sdk;
  const client = new AiBot.WSClient({ botId: creds.botId, secret: creds.secret });
  wsClient = client;

  client.on("authenticated", () => {
    log(CHECK_ONLY ? "AUTH_OK：长连接认证并订阅成功" : "长连接认证并订阅成功（只收不回）");
    if (CHECK_ONLY) {
      client.disconnect();
      process.exit(0);
    }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(PID_PATH, String(process.pid), "utf8");
  });

  for (const eventName of ["message.text", "message.image", "message.mixed", "message.voice", "message.file"]) {
    client.on(eventName, (frame) => handleFrame(eventName.replace("message.", ""), frame));
  }
  client.on("event.enter_chat", (frame) => handleFrame("enter_chat", frame));
  client.on("event.template_card_event", (frame) => handleFrame("template_card_event", frame));
  client.on("event.feedback_event", (frame) => handleFrame("feedback_event", frame));

  client.on("error", (error) => log("连接错误：" + (error && error.message ? error.message : String(error))));
  client.on("disconnected", () => log("连接断开（SDK 会自动重连）"));

  client.connect();

  const shutdown = () => {
    log("收到退出信号，断开长连接");
    try { client.disconnect(); } catch {}
    try { fs.unlinkSync(PID_PATH); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (CHECK_ONLY) {
    setTimeout(() => {
      console.error("自检超时：20 秒内没有收到 authenticated 事件");
      try { client.disconnect(); } catch {}
      process.exit(2);
    }, 20000);
  }
}

main();
