#!/usr/bin/env node
"use strict";
/**
 * 查私信漏收 · 防「忙时丢唤醒」的补看器（2026-10-12 立）
 *
 * 背景：公司私信扩展（私信收.ts）在会话忙时投放的消息会丢（扩展游标已推进、会话没收到）——
 *   实例：10-12 11:10 苗若兰回执、09:26/09:31 阿朱两封、09:50 殷素素第二封，均靠人工补看才发现。
 * 干嘛：对比「扩展已消费到的游标」与「我上次补看的位置」，把中间这段信打印出来。
 *   只读信箱、只推进我自己的位置；**不碰扩展游标**（不影响正常投递，已看过的会重印，认出来跳过即可）。
 * 用法：node scripts/查私信漏收.cjs      # 有漏就打印【私信补看】，没有就安静（退出码 0）
 * 约定：首次跑没有「我的位置」→ 以当前扩展游标为起点（从今往后），不补历史。
 */
const fs = require("node:fs");
const path = require("node:path");

const 私信目录 = "D:\\硅基公司\\交流\\私信";
const 窗名 = "木婉清";
const 信箱 = path.join(私信目录, 窗名 + ".jsonl");
const 扩展游标 = path.join(私信目录, ".已读", 窗名 + ".json");
const 我的位置 = path.join(__dirname, "..", ".state", "私信-已看.json");

const 读数 = (p) => {
	try {
		const j = JSON.parse(fs.readFileSync(p, "utf8"));
		const n = Number(j.字节);
		return Number.isFinite(n) ? n : null;
	} catch {
		return null;
	}
};

const 扩 = 读数(扩展游标);
if (扩 === null) {
	console.log("（扩展游标读不到，跳过）");
	process.exit(0);
}
if (!fs.existsSync(信箱)) process.exit(0);

const 文 = fs.readFileSync(信箱);
const 大小 = 文.length;
const 终点 = Math.min(扩, 大小);
const 我 = 读数(我的位置);
const 起点 = 我 === null ? 终点 : Math.min(Math.max(我, 0), 终点);

const 写位置 = () => {
	fs.mkdirSync(path.dirname(我的位置), { recursive: true });
	fs.writeFileSync(我的位置, JSON.stringify({ 字节: 终点, at: new Date().toISOString() }) + "\n", "utf8");
};

if (起点 >= 终点) {
	写位置(); // 首次跑：以当前扩展游标为起点，落位后从今往后才有的比
	process.exit(0); // 没漏
}

const 段 = 文.subarray(起点, 终点).toString("utf8");
for (const l of 段.split("\n")) {
	if (!l.trim()) continue;
	try {
		const m = JSON.parse(l);
		console.log(`【私信补看】(${String(m.at || "").slice(0, 16).replace("T", " ")}) ${m.from || "？"}：${m.text || ""}`);
	} catch {
		/* 半行/坏行跳过 */
	}
}
写位置();
