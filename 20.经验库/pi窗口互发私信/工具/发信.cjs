#!/usr/bin/env node
"use strict";
/**
 * 发信 · 往某个 pi 窗口的「本地信箱」投一封信（收信端见 扩展\私信收.ts）
 *
 * 用法：
 *   node 发信.cjs <收件人名> "正文" [--from 寄件人名] [--目录 信箱目录] [--干]
 *
 *   - 收件人名 = 对方窗口的工作目录名（也可以约定一个名字）；
 *   - --from   默认 = 当前工作目录名（在哪个窗口下跑就写哪个名）；
 *   - --目录   默认 = 环境变量 PI_MAILBOX 或 ~/.pi-信箱（和收信扩展同一套）；
 *   - --干     干跑：只预览不落盘（先干跑，再真发）。
 *
 * 规矩：信箱目录别进 git（放仓库里就把 信箱/ 加进 .gitignore）；
 *       同一个收件人一分钟内别连发（防刷屏）。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const 参 = process.argv.slice(2);
const 干 = 参.includes("--干");
const 目录位 = 参.indexOf("--目录");
const from位 = 参.indexOf("--from");

const 目录 =
	目录位 >= 0 && 参[目录位 + 1]
		? 参[目录位 + 1]
		: process.env.PI_MAILBOX || path.join(os.homedir(), ".pi-信箱");
const 寄件 = from位 >= 0 && 参[from位 + 1] ? 参[from位 + 1] : path.basename(process.cwd());

const 位 = 参.filter((x, i) => {
	if (x === "--干" || x === "--目录" || x === "--from") return false;
	if (目录位 >= 0 && i === 目录位 + 1) return false;
	if (from位 >= 0 && i === from位 + 1) return false;
	return true;
});
const 收件人 = String(位[0] || "").trim();
const 正文 = 位.slice(1).join(" ").trim();

if (!收件人 || !正文) {
	console.log('用法：node 发信.cjs <收件人名> "正文" [--from 寄件人名] [--目录 信箱目录] [--干]');
	process.exit(0);
}

const 记录 = JSON.stringify({ at: new Date().toISOString(), from: 寄件, text: 正文 });
if (干) {
	console.log(`干跑：→ ${收件人}（信箱 ${目录}）\n${记录}`);
	process.exit(0);
}
try {
	fs.mkdirSync(目录, { recursive: true });
	fs.appendFileSync(path.join(目录, 收件人 + ".jsonl"), 记录 + "\n", "utf8");
	console.log(`已投「${收件人}」的信箱（${正文.length} 字）→ ${path.join(目录, 收件人 + ".jsonl")}`);
} catch (e) {
	console.log("投递失败：" + (e && e.message));
	process.exit(1);
}
