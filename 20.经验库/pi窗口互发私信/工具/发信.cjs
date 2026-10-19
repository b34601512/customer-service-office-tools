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
 *   - --目录   显式指定信箱目录；不传则读环境变量 PI_MAILBOX；
 *              **两者都没有 → 直接报错退出（2026-10-19 改，见下）**；
 *   - --干     干跑：只预览不落盘（先干跑，再真发）。
 *
 * ⚠️ 2026-10-19 事故（必读）：
 *   本脚本原来的默认值是 `~/.pi-信箱`。本机真正在监视的信箱是 `D:\硅基公司\交流\私信\`
 *   （见 扩展\私信收.ts 第 6 行）。两者不是一个目录，所以用它发的信**全部静默丢失**——
 *   当天 14 封派活信没到任何人手上，包括一条「停止做趋势简报」的时效指令。
 *
 *   修法（王语嫣 2026-10-19 提议、木婉清采纳）：**默认值本身就是错的，那就不给默认值。**
 *   没显式给 --目录、也没设 PI_MAILBOX → 打印大字报错并退出 2，绝不悄悄投到一个猜的目录。
 *
 *   公司内部发信请直接用：`D:\硅基公司\员工\技术·王语嫣\工具\企微核心\私信.cjs`
 *   （它写死公司通道、带通讯录解析与防呆）。本脚本只作通用经验包示例。
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

const 显式目录 = 目录位 >= 0 && 参[目录位 + 1] ? 参[目录位 + 1] : "";
const 环境目录 = process.env.PI_MAILBOX || "";
const 目录 = 显式目录 || 环境目录;

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

// ---------- 反向约束：没有明确目录就不许发（2026-10-19 事故后加） ----------
if (!目录) {
	console.error(
		[
			"",
			"  ✗ 拒绝投递：没有指定信箱目录。",
			"",
			"    本脚本不再有默认目录。旧版默认写 ~/.pi-信箱，",
			"    而本机在监视的是 D:\\硅基公司\\交流\\私信\\ —— 两者不是一个地方，",
			"    用它发信会静默丢失（2026-10-19 丢过 14 封）。",
			"",
			"  公司内部发信请用：",
			"    node \"D:/硅基公司/员工/技术·王语嫣/工具/企微核心/私信.cjs\" \"<收件人>\" \"正文\" --from <你>",
			"",
			"  确实要用本脚本，显式给目录：",
			"    --目录 <信箱目录>   或   设置环境变量 PI_MAILBOX",
			"",
		].join("\n"),
	);
	process.exit(2);
}

const 记录 = JSON.stringify({ at: new Date().toISOString(), from: 寄件, text: 正文 });
if (干) {
	console.log(`干跑：→ ${收件人}（信箱 ${目录}）\n${记录}`);
	process.exit(0);
}

// ---------- 发送前后自检：投完必须能在「读的那一侧」看到 ----------
try {
	fs.mkdirSync(目录, { recursive: true });
	const 文件 = path.join(目录, 收件人 + ".jsonl");

	// 投之前记下文件大小，投之后确认字节确实增长（防「写成功但写错了地方/被截断」）
	const 前大小 = fs.existsSync(文件) ? fs.statSync(文件).size : 0;
	fs.appendFileSync(文件, 记录 + "\n", "utf8");
	const 后大小 = fs.statSync(文件).size;
	if (后大小 <= 前大小) {
		console.error(`✗ 投递后文件没有增长（${前大小} → ${后大小}）：${文件}`);
		process.exit(1);
	}

	// 回读最后一行，确认是自己这封
	const 尾 = fs.readFileSync(文件, "utf8").split("\n").filter(Boolean).pop();
	if (!尾 || !尾.includes(记录.slice(0, 40))) {
		console.error(`✗ 回读最后一行不是本封信：${文件}`);
		process.exit(1);
	}

	// 提醒：这个目录如果不在「收信扩展监视的那个」下面，仍然没人读
	const 疑点 = [];
	if (/\.pi-信箱/.test(目录)) {
		疑点.push("该目录名像 ~/.pi-信箱（通用经验包默认值），本机公司通道是 D:\\硅基公司\\交流\\私信\\");
	}
	console.log(`已投「${收件人}」的信箱（${正文.length} 字）→ ${文件}`);
	if (疑点.length) console.log("⚠ " + 疑点.join("；") + "——请确认对方真能读到这封信。");
} catch (e) {
	console.log("投递失败：" + (e && e.message));
	process.exit(1);
}
