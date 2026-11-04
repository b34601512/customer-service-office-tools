#!/usr/bin/env node
"use strict";
/**
 * 查收件（本机，只读）：按人名 / 时间段 / 关键字翻本机收件箱与发信台账。
 *
 * 为什么有它（2026-11-04 自查第 8 条「只调命令，别临场拼」）：
 *   核「某人回没回」「今天主动发了几条」这类事，以前每次都现写一段 `node -e` 去 grep jsonl，
 *   写法每次都不一样、字段名记错就静默查出 0 条（当天真踩过：拿 ISO 时间去比 JST 字符串，漏了整晚消息）。
 *   现在一条命令，字段归一、时间是 JST、查不到就明说「0 条」。
 *
 * 用法：
 *   node 工具/查收件.cjs --人 邓某某                    # 这个人发的所有消息（收件箱）
 *   node 工具/查收件.cjs --人 邓某某 --日 2026-11-04    # 只看某天（JST）
 *   node 工具/查收件.cjs --日 2026-11-04 --时 22:00-23:59
 *   node 工具/查收件.cjs --词 拼3                       # 全文关键字
 *   node 工具/查收件.cjs --发 --日 2026-11-04           # 看发信台账（主动/回复、成功与否）
 *   node 工具/查收件.cjs --发 --日 2026-11-04 --数      # 只数条数（成功/失败分开）
 *   node 工具/查收件.cjs --人 邓某某 --全文             # 打印正文全文，不截断
 *
 * 退出码：查到 0；0 条 3；参数/文件问题 2。
 */
const fs = require("fs");
const path = require("path");

const 收件箱目录 = path.join(__dirname, "企微", "收件箱");
const 收件 = path.join(收件箱目录, "inbox.jsonl");
const 发件 = path.join(收件箱目录, "outbox.jsonl");

function 解析参数(argv) {
  const 参 = { 全文: false, 数: false, 发: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--人") 参.人 = argv[++i];
    else if (a === "--日") 参.日 = argv[++i];
    else if (a === "--时") 参.时 = argv[++i];
    else if (a === "--词") 参.词 = argv[++i];
    else if (a === "--发") 参.发 = true;
    else if (a === "--数") 参.数 = true;
    else if (a === "--全文") 参.全文 = true;
    else if (a === "-h" || a === "--help") 参.帮 = true;
    else { console.error("不认识的参数：" + a); process.exit(2); }
  }
  return 参;
}

/** 把各种时间写法归一到 JST 的 "YYYY-MM-DD HH:MM"（本机日志里两种都有：带 Z 的 ISO 与已转好的 JST 串） */
function 归一时刻(t) {
  if (!t) return "";
  const s = String(t);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) {
    const d = new Date(s);
    const j = new Date(d.getTime() + 9 * 3600 * 1000);
    return j.toISOString().slice(0, 16).replace("T", " ");
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16).replace("T", " ");
  return s.slice(0, 16);
}

function 读行(p) {
  if (!fs.existsSync(p)) {
    console.error("没找到 " + p);
    process.exit(2);
  }
  return fs.readFileSync(p, "utf8")
    .split("\n")
    .map((x) => { try { return JSON.parse(x); } catch (e) { return null; } })
    .filter(Boolean);
}

function 名表() {
  // 共享名单的格式是扁平的 {userid: "名字"}（外加两条说明键）；收件箱里 fromName 实测是空串，只能靠它反查
  const 候选 = [
    "D:/硅基公司/共享/企微工具/发送人名单.json",
    path.join(__dirname, "企微", ".state", "人名表.json"),
  ];
  for (const p of 候选) {
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      const 表 = new Map();
      for (const [k, v] of Object.entries(j)) {
        if (typeof v === "string" && k.startsWith("wo")) 表.set(String(v).replace(/（.*?）|\(.*?\)/g, ""), k);
      }
      if (表.size) return 表;
    } catch (e) { /* 换下一份 */ }
  }
  return new Map();
}

const 参 = 解析参数(process.argv.slice(2));
if (参.帮) {
  console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^[\s\S]*?\/\*\*/, ""));
  process.exit(0);
}

const 行 = 读行(参.发 ? 发件 : 收件);
const 名转id = 名表();
const id转名 = new Map([...名转id].map(([n, id]) => [id, n]));

const 命中 = 行.filter((r) => {
  const 时刻 = 归一时刻(r.at || r.receivedAt);
  if (参.日 && !时刻.startsWith(参.日)) return false;
  if (参.时) {
    const [起, 止] = String(参.时).split("-");
    const hm = 时刻.slice(11);
    if (起 && hm < 起) return false;
    if (止 && hm > 止) return false;
  }
  if (参.人) {
    const 目标 = 参.人.replace(/（.*?）|\(.*?\)/g, "");
    const 名 = String(r.fromName || r.目标名 || "").replace(/（.*?）|\(.*?\)/g, "");
    const id = 名转id.get(目标) || "";
    if (名 !== 目标 && !(id && (r.fromUserId === id || r.目标 === id))) return false;
  }
  if (参.词) {
    const 全文串 = JSON.stringify(r);
    if (!全文串.includes(参.词)) return false;
  }
  return true;
});

if (参.数) {
  if (参.发) {
    const 成 = 命中.filter((r) => r.成功 !== false).length;
    console.log(`发信 ${参.日 || "全部"}：成功 ${成} 条 / 共 ${命中.length} 条（失败 ${命中.length - 成}）`);
  } else {
    console.log(`收信 ${参.日 || "全部"}：${命中.length} 条`);
  }
  process.exit(命中.length ? 0 : 3);
}

if (!命中.length) {
  console.log("0 条（按这些条件没查到；人名要跟发消息用的写法一致，或换 --词 搜全文）");
  process.exit(3);
}

for (const r of 命中) {
  const 时刻 = 归一时刻(r.at || r.receivedAt);
  const 谁 = r.fromName || r.目标名 || id转名.get(r.fromUserId) || (r.fromUserId ? "（无名字）" : "");
  const 文 = String(r.text || r.开头 || "").replace(/\s+/g, " ");
  const 态 = r.成功 === false ? "✗" : "";
  console.log(`${时刻} | ${谁}${态} | ${参.全文 ? 文 : 文.slice(0, 60)}`);
}
console.log(`—— 共 ${命中.length} 条`);
