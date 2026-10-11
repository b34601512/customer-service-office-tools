// 冒烟测试：不用真开两个窗口，也能验证「收信扩展」的逻辑——
//   假造一个 pi 对象加载扩展 → 投信 → 看它有没有「注入」；再测游标、自投不注入、重开补投。
//
// 跑法（Node ≥ 23.6 自带 TypeScript 类型剥离，直接跑）：
//   node 测试\冒烟测试.mjs
// 老一点的 Node（22.x）：node --experimental-strip-types 测试\冒烟测试.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const 测试根 = fs.mkdtempSync(path.join(os.tmpdir(), "pi-信箱冒烟-"));
process.env.PI_MAILBOX = 测试根; // 让扩展和发信都落在这个临时信箱里

const 临时窗根 = fs.mkdtempSync(path.join(os.tmpdir(), "pi-窗-"));
const 窗目录 = path.join(临时窗根, "测试窗");
fs.mkdirSync(窗目录);

const 本文件目录 = path.dirname(fileURLToPath(import.meta.url));
const 信箱 = (名) => path.join(测试根, 名 + ".jsonl");
const 投 = (名, from, text) =>
	fs.appendFileSync(信箱(名), JSON.stringify({ at: "2026-10-11T22:00:00Z", from, text }) + "\n", "utf8");
const 等 = (毫秒) => new Promise((r) => setTimeout(r, 毫秒));

let 失败 = 0;
function 断言(条件, 说明) {
	if (条件) console.log("  ✓ " + 说明);
	else {
		失败++;
		console.log("  ✗ " + 说明);
	}
}

let 装载号 = 0;
async function 开窗() {
	const 注入 = [];
	const 处理表 = {};
	const 假pi = {
		on: (事件, 处理) => {
			处理表[事件] = 处理;
		},
		sendUserMessage: (文字, 选项) => 注入.push({ 文字, 选项 }),
	};
	const 扩展 = await import(`../扩展/私信收.ts?v=${++装载号}`);
	扩展.default(假pi);
	await 处理表.session_start({}, { cwd: 窗目录 });
	return { 处理表, 注入 };
}

console.log("== 1) 开窗 → 投一封 → 应该注入 ==");
const 窗1 = await 开窗();
投("测试窗", "同事甲", "你好，我是甲");
await 等(600);
断言(窗1.注入.length === 1, `注入 1 次（实际 ${窗1.注入.length}）`);
断言(窗1.注入[0]?.文字.includes("同事甲") && 窗1.注入[0]?.文字.includes("你好，我是甲"), "内容带寄件人和正文");
断言(fs.existsSync(path.join(测试根, ".已读", "测试窗.json")), "游标文件已写");

console.log("== 2) 自己写给自己：不注入 ==");
投("测试窗", "测试窗", "自己的信");
await 等(600);
断言(窗1.注入.length === 1, `注入数不变（实际 ${窗1.注入.length}）`);

console.log("== 3) 再来一封别人的：只投新的 ==");
投("测试窗", "同事乙", "第二封");
await 等(600);
断言(窗1.注入.length === 2, `注入 2 次（实际 ${窗1.注入.length}）`);
断言(窗1.注入[1]?.文字.includes("第二封") && !窗1.注入[1]?.文字.includes("你好，我是甲"), "第二封只带新信、不重复旧信");

console.log("== 4) 关窗重开（模拟重载）：旧信不重投 ==");
await 窗1.处理表.session_shutdown();
const 窗2 = await 开窗();
await 等(300);
断言(窗2.注入.length === 0, `重开无重复投递（实际 ${窗2.注入.length}）`);

console.log("== 5) 重开后新信照收 ==");
投("测试窗", "同事丙", "第三封");
await 等(600);
断言(窗2.注入.length === 1 && 窗2.注入[0].文字.includes("第三封"), `只投第三封（实际 ${窗2.注入.length}）`);

console.log("== 6) 发信脚本（工具\\发信.cjs）落盘 ==");
const 出 = execFileSync(
	process.execPath,
	[path.join(本文件目录, "..", "工具", "发信.cjs"), "测试窗", "回你一封", "--from", "同事丙", "--目录", 测试根],
	{ encoding: "utf8" },
);
断言(出.includes("已投"), "发信脚本落盘成功");
await 等(600);
const 行 = fs.readFileSync(信箱("测试窗"), "utf8").trim().split("\n");
断言(行.length === 5, `信箱共 5 行（实际 ${行.length}）`);
const 末 = JSON.parse(行[行.length - 1]);
断言(末.from === "同事丙" && 末.text === "回你一封", "最后一封内容对");
断言(窗2.注入.length === 2 && 窗2.注入[1].文字.includes("回你一封"), "发信脚本投的也被注入");

console.log("== 7) 干跑不落盘 ==");
const 行数前 = fs.readFileSync(信箱("测试窗"), "utf8").split("\n").length;
execFileSync(process.execPath, [path.join(本文件目录, "..", "工具", "发信.cjs"), "测试窗", "干跑信", "--干", "--目录", 测试根], { encoding: "utf8" });
断言(fs.readFileSync(信箱("测试窗"), "utf8").split("\n").length === 行数前, "干跑没有写入");

await 窗2.处理表.session_shutdown();
fs.rmSync(测试根, { recursive: true, force: true });
fs.rmSync(临时窗根, { recursive: true, force: true });

console.log("");
if (失败) {
	console.log(`结果：${失败} 项失败`);
	process.exit(1);
} else {
	console.log("全部通过 ✓");
}
