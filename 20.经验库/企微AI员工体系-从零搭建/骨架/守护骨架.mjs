#!/usr/bin/env node
// 企微 AI 机器人「收件守护」骨架 —— 从零搭建的第 2 步：让机器人有一扇常开的耳朵。
//
// 它干三件事（一件长连接上做完）：
//   ① 常驻订阅机器人消息（单聊 / 群里 @它），一条条落进 收件箱/inbox.jsonl（JSONL：一行一条）；
//   ② 开一个只绑本机（127.0.0.1）的发送口，别的脚本 POST 它代发 ——
//      因为官方限制「同一机器人同时只能有一条有效长连接」，发也走这一条（另开会把守护顶掉，
//      顶掉的空档里平台不补推消息）；
//   ③ 掉线退避重连（官方 SDK 的自动重连实测不一定回来，自己补一层）。
//
// 用法：
//   node 守护骨架.mjs                       # 常驻收件（Ctrl+C 退出）
//   node 守护骨架.mjs --check               # 只验证凭据：连上并认证成功就退出（联网）
//   node 守护骨架.mjs --离线自检            # 不联网：假帧→落盘→读回→发送口自检（首次装机先跑这个）
//   node 守护骨架.mjs --接管                # 顶掉已在跑的旧守护（默认发现已有实例就拒绝启动）
//   node 守护骨架.mjs --凭据 <文件> --收件箱 <目录> --端口 <n>
//
// 凭据（不进 git、不贴聊天记录）：默认读 ./机器人凭据.local.json，格式 {"botId":"…","secret":"…"}
//                              或用环境变量 WECOM_BOT_ID / WECOM_BOT_SECRET
// 依赖：Node ≥ 18；真连收件要 npm i @wecom/aibot-node-sdk（离线自检不要依赖）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const 参 = 解析参数(process.argv.slice(2));
const 收件箱目录 = path.resolve(参.收件箱 || "./收件箱");
const 收件箱文件 = path.join(收件箱目录, "inbox.jsonl");
const 媒体目录 = path.join(收件箱目录, "media");
const PID文件 = path.join(收件箱目录, "守护.pid");

function 记(行, 目录 = 收件箱目录) {
  try {
    fs.mkdirSync(目录, { recursive: true });
    fs.appendFileSync(path.join(目录, "守护.log"), `[${new Date().toLocaleString("zh-CN", { hour12: false })}] ${行}\n`, "utf8");
  } catch { /* 日志失败不致命 */ }
}

function 解析参数(argv) {
  const 出 = { check: false, 离线自检: false, 接管: false, 凭据: "", 收件箱: "", 端口: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--check") 出.check = true;
    else if (k === "--离线自检") 出.离线自检 = true;
    else if (k === "--接管") 出.接管 = true;
    else if (k === "--凭据") { 出.凭据 = String(argv[i + 1] || ""); i += 1; }
    else if (k === "--收件箱") { 出.收件箱 = String(argv[i + 1] || ""); i += 1; }
    else if (k === "--端口") { 出.端口 = Number(argv[i + 1]) || 0; i += 1; }
    else if (k === "--help" || k === "-h") 出.帮助 = true;
  }
  return 出;
}

// ---------------------------------------------------------------------------
// 收件记录：SDK 帧 → 可落盘的一条（只留给人看的字段；内部 ID 只落本地文件、不打印）
// ---------------------------------------------------------------------------
function 本地时间(createTime) {
  if (!createTime) return new Date().toISOString();
  const ms = createTime < 1e12 ? createTime * 1000 : createTime;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function 混排项(body) {
  const items = body && body.mixed ? body.mixed.msg_item || body.mixed.items : null;
  return Array.isArray(items) ? items : [];
}
function 提取正文(body) {
  if (!body || typeof body !== "object") return "";
  if (body.text && typeof body.text.content === "string") return body.text.content;
  if (body.voice && typeof body.voice.content === "string") return body.voice.content;
  if (body.mixed) {
    return 混排项(body)
      .map((i) => (i && i.text && typeof i.text.content === "string" ? i.text.content : i && i.image ? "[图片]" : i && i.file ? "[文件]" : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}
function 提取媒体列表(body) {
  const 出 = [];
  const 收 = (i) => {
    if (!i) return;
    if (i.image && i.image.url) 出.push({ kind: "image", url: i.image.url, aeskey: i.image.aeskey || "", name: "" });
    else if (i.file && i.file.url) 出.push({ kind: "file", url: i.file.url, aeskey: i.file.aeskey || "", name: i.file.name || "" });
    else if (i.voice && i.voice.url) 出.push({ kind: "voice", url: i.voice.url, aeskey: i.voice.aeskey || "", name: "" });
    else if (i.video && i.video.url) 出.push({ kind: "video", url: i.video.url, aeskey: i.video.aeskey || "", name: "" });
  };
  收(body);
  if (body && body.mixed) for (const i of 混排项(body)) 收(i);
  return 出;
}
export function 建记录(frame) {
  const body = (frame && frame.body) || {};
  const from = body.from || {};
  return {
    at: 本地时间(body.create_time),
    receivedAt: new Date().toISOString(),
    msgid: body.msgid || (frame && frame.headers && frame.headers.req_id) || "",
    msgtype: body.msgtype || "unknown",
    chattype: body.chattype || "",
    chatid: body.chatid || "",
    fromUserId: from.userid || "",
    fromName: from.name || "",
    text: 提取正文(body),
    quoteText: body.quote && body.quote.text && typeof body.quote.text.content === "string" ? body.quote.text.content : "",
    媒体列表: 提取媒体列表(body),
  };
}

function 落盘(record) {
  fs.mkdirSync(收件箱目录, { recursive: true });
  fs.appendFileSync(收件箱文件, JSON.stringify(record) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// 本机发送口：POST /发送（正文）→ 走守护那条长连接发。带随机令牌，只绑 127.0.0.1。
// ---------------------------------------------------------------------------
function 起发送口(取客户端, 目录 = 收件箱目录) {
  const 端口文件 = path.join(目录, "守护.port");
  const 令牌文件 = path.join(目录, "守护.token");
  const token = crypto.randomBytes(16).toString("hex");
  const 服务 = http.createServer((req, res) => {
    const 答 = (码, 体) => {
      res.writeHead(码, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(体));
    };
    if (req.headers["x-token"] !== token) return 答(403, { 错误: "令牌不对" });
    if (req.method === "GET") return 答(200, { 认证: true, 收件箱: 收件箱文件 });
    if (req.method !== "POST") return 答(405, { 错误: "只支持 GET/POST" });
    let 体 = "";
    req.on("data", (c) => { 体 += c; if (体.length > 200000) req.destroy(); });
    req.on("end", async () => {
      try {
        const { 目标, 正文 } = JSON.parse(体 || "{}");
        if (!目标 || !正文) return 答(400, { 错误: "要 {目标, 正文}" });
        const 客户端 = 取客户端();
        if (!客户端) return 答(503, { 错误: "长连接没就绪" });
        const 回执 = await 客户端.sendMessage(String(目标), { msgtype: "markdown", markdown: { content: String(正文) } });
        const 成 = !回执 || 回执.errcode === undefined || 回执.errcode === 0;
        记(`代发→（不记地址）文字${成 ? "成功" : "回执异常"}`);
        return 答(成 ? 200 : 502, { 成功: 成 ? 1 : 0 });
      } catch (error) {
        return 答(500, { 错误: String((error && error.message) || error) });
      }
    });
  });
  服务.on("error", (e) => 记("发送口起不来：" + e.message));
  服务.listen(参.端口 || 0, "127.0.0.1", () => {
    fs.mkdirSync(目录, { recursive: true });
    fs.writeFileSync(端口文件, String(服务.address().port), "utf8");
    fs.writeFileSync(令牌文件, token, "utf8");
    记(`本机发送口就绪：127.0.0.1:${服务.address().port}（发消息走这条连接）`, 目录);
  });
  return 服务;
}

// ---------------------------------------------------------------------------
// 凭据
// ---------------------------------------------------------------------------
function 读凭据() {
  let 数据 = null;
  const 文件 = 参.凭据 ? path.resolve(参.凭据) : path.resolve("./机器人凭据.local.json");
  if (fs.existsSync(文件)) {
    try { 数据 = JSON.parse(fs.readFileSync(文件, "utf8")); } catch (e) { throw new Error(`凭据文件读不出来：${e.message}`); }
  } else if (process.env.WECOM_BOT_ID && process.env.WECOM_BOT_SECRET) {
    数据 = { botId: process.env.WECOM_BOT_ID, secret: process.env.WECOM_BOT_SECRET };
  } else {
    throw new Error(`没找到凭据：${文件}（或设环境变量 WECOM_BOT_ID / WECOM_BOT_SECRET）`);
  }
  const botId = String(数据.botId || 数据.bot_id || "").trim();
  const secret = String(数据.secret || "").trim();
  if (!botId || !secret || /填|示例|你的|xxxx/i.test(botId + secret)) throw new Error("凭据还是占位文字，先填真实 Bot ID / Secret");
  return { botId, secret };
}

// ---------------------------------------------------------------------------
// 常驻收件
// ---------------------------------------------------------------------------
async function 连上常驻() {
  const 旧 = fs.existsSync(PID文件) ? Number(fs.readFileSync(PID文件, "utf8").trim()) : 0;
  if (旧 && 旧 !== process.pid) {
    const 查 = spawnSync("tasklist", ["/FI", `PID eq ${旧}`, "/NH"], { encoding: "utf8" });
    const 活着 = /node\.exe/i.test(查.stdout || "");
    if (活着 && !参.接管) {
      console.log(`已有守护在跑（pid ${旧}），不开第二条长连接（要顶替：--接管）`);
      记("发现已有实例，退出");
      return;
    }
    if (活着) spawnSync("taskkill", ["/F", "/PID", String(旧)], { encoding: "utf8" });
  }

  const require_ = createRequire(import.meta.url);
  let sdk;
  try { sdk = require_("@wecom/aibot-node-sdk"); } catch { console.error("缺依赖：先 npm i @wecom/aibot-node-sdk"); process.exitCode = 1; return; }
  const 凭据 = 读凭据();
  const WSClient = (sdk.default || sdk).WSClient;
  let 客户端 = new WSClient({ botId: 凭据.botId, secret: 凭据.secret });
  let 重连次数 = 0;
  const 已见 = new Set();

  客户端.on("authenticated", () => {
    重连次数 = 0;
    if (参.check) {
      记("自检 OK：长连接已认证并订阅成功");
      console.log("自检 OK：长连接已认证并订阅成功");
      客户端.disconnect();
      process.exit(0);
    }
    fs.mkdirSync(收件箱目录, { recursive: true });
    fs.writeFileSync(PID文件, String(process.pid), "utf8");
    记(`长连接已认证并订阅成功；收件箱：${收件箱文件}`);
  });

  const 处理 = (kind, frame) => {
    const r = 建记录(frame);
    r.kind = kind;
    if (r.msgid) {
      if (已见.has(r.msgid)) return;
      已见.add(r.msgid);
      if (已见.size > 5000) 已见.delete(已见.values().next().value);
    }
    落盘(r);
    const 谁 = r.chattype === "group" ? "群聊" : "单聊";
    记(`收到${谁}消息 [${r.msgtype}] ${(r.text || "").replace(/\s+/g, " ").slice(0, 80)}`);
  };
  for (const ev of ["message.text", "message.image", "message.mixed", "message.voice", "message.file", "message.video"]) {
    客户端.on(ev, (f) => 处理(ev.replace("message.", ""), f));
  }
  for (const ev of ["event.enter_chat", "event.template_card_event"]) {
    客户端.on(ev, (f) => 处理(ev.replace("event.", ""), f));
  }
  客户端.on("error", (e) => 记("连接错误：" + ((e && e.message) || e)));
  客户端.on("disconnected", () => {
    记("连接断开（断线期间的消息平台不补推，立刻重连）");
    if (参.check) return;
    const 等 = Math.min(30000, 3000 * (重连次数 += 1) + 3000);
    setTimeout(() => { try { 客户端.connect(); } catch (e) { 记("重连失败：" + ((e && e.message) || e)); } }, 等);
  });

  起发送口(() => 客户端);
  客户端.connect();
  const 收工 = () => {
    记("收到退出信号，断开长连接");
    try { 客户端.disconnect(); } catch { /* ignore */ }
    try { fs.unlinkSync(PID文件); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", 收工);
  process.on("SIGTERM", 收工);
}

// ---------------------------------------------------------------------------
// 离线自检：不联网 —— 假帧→建记录→落盘→读回；发送口起来→本机 GET 验令牌
// ---------------------------------------------------------------------------
async function 离线自检() {
  const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), "守护骨架-离线自检-"));
  fs.mkdirSync(临时, { recursive: true });
  const 假帧 = {
    headers: { req_id: "req-自检" },
    body: {
      create_time: Math.floor(Date.now() / 1000),
      msgid: "msg-自检-1",
      msgtype: "text",
      chattype: "single",
      chatid: "",
      from: { userid: "user-自检", name: "自检来访者" },
      text: { content: "你好，这是一条自检消息" },
    },
  };
  const r = 建记录(假帧);
  const 行 = JSON.stringify(r);
  fs.appendFileSync(path.join(临时, "inbox.jsonl"), 行 + "\n", "utf8");
  const 读回 = JSON.parse(fs.readFileSync(path.join(临时, "inbox.jsonl"), "utf8").trim());
  const 一 = 读回.text === "你好，这是一条自检消息" && 读回.fromName === "自检来访者" && 读回.chattype === "single";
  console.log(`  ${一 ? "✓" : "✗"} 假帧 → 建记录 → 落盘 → 读回（字段齐全）`);
  const 服务 = 起发送口(() => null, 临时);
  try {
    await new Promise((r2) => setTimeout(r2, 150));
    const 口 = fs.readFileSync(path.join(临时, "守护.port"), "utf8").trim();
    const 令 = fs.readFileSync(path.join(临时, "守护.token"), "utf8").trim();
    const 答 = await fetch(`http://127.0.0.1:${口}/`, { headers: { "x-token": 令 } });
    const j = await 答.json();
    const 二 = 答.status === 200 && j.认证 === true;
    console.log(`  ${二 ? "✓" : "✗"} 发送口：本机 GET / 带令牌 → 200 {认证:true}`);
    const 答2 = await fetch(`http://127.0.0.1:${口}/`, { headers: { "x-token": "wrong-token" } });
    const 三 = 答2.status === 403;
    console.log(`  ${三 ? "✓" : "✗"} 发送口：错令牌 → 403`);
    if (!(一 && 二 && 三)) process.exitCode = 1;
    console.log(一 && 二 && 三 ? "离线自检通过 ✓（真连收件：填好凭据后跑 --check）" : "离线自检失败 ✗");
  } finally {
    服务.close();
    fs.rmSync(临时, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
export async function main() {
  if (参.帮助) {
    console.log("用法：node 守护骨架.mjs [--check|--离线自检|--接管] [--凭据 <文件>] [--收件箱 <目录>] [--端口 <n>]");
  } else if (参.离线自检) {
    await 离线自检();
  } else {
    await 连上常驻();
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("守护骨架.mjs")) await main();
