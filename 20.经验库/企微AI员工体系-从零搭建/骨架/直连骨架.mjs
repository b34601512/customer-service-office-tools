#!/usr/bin/env node
// 企微 AI 机器人「直连发送」骨架 —— 从零搭建的第 3 步：给机器人一张嘴。
//
// 设计要点：
//   · 发消息不新开连接，POST 给正在跑的「收件守护」本机发送口代发（同一机器人只许一条长连接）；
//   · 默认 dry-run（只预览不发送），加 --send 才真发 —— 防手滑；
//   · 目标（谁能收）不手打：从收件箱归纳「最近跟机器人说过话的人/群」——官方只允许
//     发给「授权人本人」或「最近有往来的会话」；
//   · 打印一律用姓名/群名，不打印内部 ID；
//   · 正文自动拆条，每条 ≤100 字（企微单条信道约 100 字，像人聊天）；
//   · 限频意识：官方约 20 条/分钟，脚本失败不自动重发（重复消息比漏一条更糟）。
//
// 用法：
//   node 直连骨架.mjs --list                      # 看谁能收（编号；不打印内部 ID）
//   node 直连骨架.mjs --回复 "你好"                # 预览：回给最近发消息的人/群
//   node 直连骨架.mjs --回复 "你好" --send         # 真发
//   node 直连骨架.mjs --to 2 --文本 "汇报…" --send
//   node 直连骨架.mjs --to 2 --文件 汇报.md --send
//   node 直连骨架.mjs --收件箱 <目录>              # 默认 ./收件箱（与守护一致）
//
// 依赖：Node ≥ 18（用内置 fetch），零第三方依赖。

import fs from "node:fs";
import path from "node:path";

const 参 = 解析参数(process.argv.slice(2));
const 收件箱目录 = path.resolve(参.收件箱 || "./收件箱");
const 收件箱文件 = path.join(收件箱目录, "inbox.jsonl");
const 端口文件 = path.join(收件箱目录, "守护.port");
const 令牌文件 = path.join(收件箱目录, "守护.token");
const 上限 = 100;

function 解析参数(argv) {
  const 出 = { list: false, to: "", 文本: "", 文件: "", 回复: undefined, send: false, 收件箱: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--list") 出.list = true;
    else if (k === "--to") { 出.to = String(argv[i + 1] || "").trim(); i += 1; }
    else if (k === "--文本" || k === "--text") { 出.文本 = String(argv[i + 1] || ""); i += 1; }
    else if (k === "--文件" || k === "--file") { 出.文件 = String(argv[i + 1] || "").trim(); i += 1; }
    else if (k === "--回复" || k === "--reply") { 出.回复 = String(argv[i + 1] || ""); i += 1; }
    else if (k === "--send") 出.send = true;
    else if (k === "--收件箱") { 出.收件箱 = String(argv[i + 1] || ""); i += 1; }
    else if (k === "--help" || k === "-h") 出.帮助 = true;
  }
  return 出;
}

/** 按正文字数拆条（默认每条约 100 字）。 */
export function 拆条(正文, 每 = 上限) {
  const s = String(正文 || "");
  const 出 = [];
  for (let i = 0; i < s.length; i += 每) 出.push(s.slice(i, i + 每));
  return 出.length ? 出 : [""];
}

/** 读收件箱记录（一行一条 JSON）。 */
export function 读收件箱(文件 = 收件箱文件) {
  if (!fs.existsSync(文件)) return [];
  const 出 = [];
  for (const line of fs.readFileSync(文件, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { 出.push(JSON.parse(line)); } catch { /* 坏行跳过 */ }
  }
  return 出;
}

/** 从收件箱归纳「谁能收消息」：单聊按人、群聊按群；最近的排前面。 */
export function 收信人(记录们) {
  const 表 = new Map();
  for (const r of 记录们) {
    const 群聊 = r.chattype === "group";
    const id = 群聊 ? r.chatid : r.fromUserId;
    if (!id) continue;
    表.delete(id);
    表.set(id, {
      id,
      类: 群聊 ? "群聊" : "单聊",
      名: (群聊 ? r.fromName || "（没留群名）" : r.fromName) || "（没留名字）",
      最近: r.at || "",
    });
  }
  return [...表.values()];
}

function 预览(目标, 文本条数) {
  console.log(`目标：${目标.类}「${目标.名}」　文字 ${文本条数} 条（每条 ≤${上限} 字）`);
}

async function 发送(目标, 正文) {
  if (!fs.existsSync(端口文件) || !fs.existsSync(令牌文件)) throw new Error("找不到守护发送口（守护没在跑？先起 守护骨架.mjs）");
  const 口 = fs.readFileSync(端口文件, "utf8").trim();
  const 令 = fs.readFileSync(令牌文件, "utf8").trim();
  const 条 = 拆条(正文);
  let i = 0;
  for (const 一段 of 条) {
    i += 1;
    const 答 = await fetch(`http://127.0.0.1:${口}/发送`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "x-token": 令 },
      body: JSON.stringify({ 目标: 目标.id, 正文: 一段 }),
    });
    const j = await 答.json().catch(() => ({}));
    if (答.status !== 200 || j.成功 !== 1) throw new Error(`第 ${i}/${条.length} 条失败：${JSON.stringify(j).slice(0, 200)}`);
    console.log(`  → 发送第 ${i}/${条.length} 条（文字）成功`);
  }
}

// ---------------------------------------------------------------------------
if (参.帮助) console.log("用法：node 直连骨架.mjs [--list|--回复 文字|--to N --文本 文字|--文件 文件] [--send]");
else {
  const 记录们 = 读收件箱();
  const 名单 = 收信人(记录们);
  if (参.list) {
    if (!名单.length) console.log("收件箱还没有人跟机器人说过话（让对方先发一条）");
    for (let i = 0; i < 名单.length; i += 1) console.log(`${i + 1}. ${名单[i].类}「${名单[i].名}」　最近 ${名单[i].最近}`);
  } else if (参.回复 !== undefined || 参.to) {
    let 目标;
    if (参.回复 !== undefined) {
      if (!记录们.length) { console.error("收件箱还没记录，不知道回给谁（让对方先发一条）"); process.exit(2); }
      const 最近 = 记录们[记录们.length - 1];
      目标 = 收信人([最近])[0];
      参.文本 = 参.文本 || 参.回复;
    } else {
      目标 = 名单[Number(参.to) - 1];
      if (!目标) 目标 = 名单.find((x) => x.名 === 参.to || x.id === 参.to);
    }
    if (!目标) { console.error("找不到目标：--list 看看编号，或 --to 名字"); process.exit(2); }
    let 正文 = 参.文本;
    if (参.文件) {
      if (!fs.existsSync(参.文件)) { console.error("文件不存在：" + 参.文件); process.exit(2); }
      正文 = fs.readFileSync(参.文件, "utf8");
    }
    if (!正文) { console.error("缺正文：--文本/--文件/--回复"); process.exit(2); }
    预览(目标, 拆条(正文).length);
    if (!参.send) {
      console.log("dry-run：只在本地预览，没有发送。确认无误后加 --send。");
    } else {
      console.log("走守护那条长连接发（不另开连接）");
      await 发送(目标, 正文);
      console.log("✓ 全部发送成功");
    }
  } else {
    console.log("用法：node 直连骨架.mjs --list | --回复 文字 [--send] | --to N --文本 文字 [--send]（--help 看全）");
  }
}
