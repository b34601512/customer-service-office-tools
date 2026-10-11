/**
 * 私信收 · pi 窗口之间「本地信箱」私信 —— 收信端（装在用户扩展目录，各窗通用）
 *
 * 原理：
 *   - 每个 pi 窗口加载本扩展；`session_start` 时以「工作目录名」为本窗的名字；
 *   - 盯 `<信箱目录>/<本窗名>.jsonl`；有新信 → `pi.sendUserMessage()` 把信注入成
 *     本窗的一条「用户消息」（非流式时必触发一轮）→ 空闲/沉睡的窗口醒来干活；
 *   - 窗口关着也不丢：信留在信箱，下次启动按游标（`.已读/<名>.json`）补投；
 *   - 自己写给自己（from === 本窗名）不注入（防死循环）。
 *
 * 安装：
 *   - 用户级：复制到 `~/.pi/agent/extensions/私信收.ts`（本机所有 pi 窗一次到位）；
 *   - 项目级：放某个窗口的 `.pi/extensions/`（只给那个窗长耳朵）。
 *   - pi 用 jiti 直接加载 TypeScript，无需编译；老窗口 `/reload` 或重开一次才生效。
 *
 * 信箱目录：默认 `~/.pi-信箱`，可用环境变量 `PI_MAILBOX` 改（发信脚本认同一套）。
 * 边界：只读本地信箱文件，不开网络端口、不碰别的进程；注入的是普通用户消息，会话里可见可审计。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const 信箱目录 = process.env.PI_MAILBOX || path.join(os.homedir(), ".pi-信箱");

export default function (pi: ExtensionAPI) {
	let 窗名 = "";
	let 监视器: fs.FSWatcher | null = null;
	let 偏移 = 0; // 已投递到的字节数
	let 余 = ""; // 半行缓冲（写了一半的行）

	const 信箱文件 = () => path.join(信箱目录, 窗名 + ".jsonl");
	const 游标文件 = () => path.join(信箱目录, ".已读", 窗名 + ".json");

	function 读游标(): number {
		try {
			return Number(JSON.parse(fs.readFileSync(游标文件(), "utf8")).字节) || 0;
		} catch {
			return 0;
		}
	}
	function 写游标(n: number) {
		try {
			fs.mkdirSync(path.dirname(游标文件()), { recursive: true });
			fs.writeFileSync(游标文件(), JSON.stringify({ 字节: n, at: new Date().toISOString() }) + "\n", "utf8");
		} catch { /* 记不上不致命：下次会重投 */ }
	}

	function 投递() {
		try {
			const 文件 = 信箱文件();
			if (!fs.existsSync(文件)) return;
			const 大小 = fs.statSync(文件).size;
			if (大小 < 偏移) 偏移 = 0; // 文件被截断（重建过）
			if (大小 <= 偏移) return;
			const fd = fs.openSync(文件, "r");
			const 节 = Buffer.alloc(大小 - 偏移);
			fs.readSync(fd, 节, 0, 节.length, 偏移);
			fs.closeSync(fd);

			const 文 = 余 + 节.toString("utf8");
			const 行 = 文.split("\n");
			余 = 行.pop() ?? ""; // 最后一段可能是没写完的半行
			const 完整 = 行.filter((l) => l.trim());
			const 新信: string[] = [];
			for (const l of 完整) {
				try {
					const m = JSON.parse(l);
					if (!m || !m.text) continue;
					if (String(m.from || "") === 窗名) continue; // 自己写的不叫自己
					新信.push(`（${String(m.at || "").slice(0, 16).replace("T", " ")}）${String(m.from || "？")}：${String(m.text)}`);
				} catch { /* 坏行跳过 */ }
			}
			const 已投字节 = Buffer.byteLength(文.slice(0, 文.length - 余.length), "utf8");
			偏移 += 已投字节;
			写游标(偏移);

			if (新信.length) {
				const 合并 = `【私信】收到 ${新信.length} 封信（本地信箱）：\n` + 新信.join("\n");
				try {
					pi.sendUserMessage(合并);
				} catch {
					try {
						pi.sendUserMessage(合并, { deliverAs: "followUp" });
					} catch { /* 都失败就等下次 */ }
				}
			}
		} catch { /* 任何异常都不打扰会话 */ }
	}

	function 开监视() {
		try {
			fs.mkdirSync(信箱目录, { recursive: true });
			if (监视器) 监视器.close();
			监视器 = fs.watch(信箱目录, (_e, 名) => {
				if (!名 || String(名).startsWith(窗名 + ".")) 投递();
			});
		} catch { /* 监视失败就靠下次 session_start 补投 */ }
	}

	pi.on("session_start", async (_e, ctx) => {
		const cwd = String((ctx as unknown as { cwd?: string })?.cwd || process.cwd());
		窗名 = path.basename(cwd);
		偏移 = 读游标();
		投递(); // 补投离线期间的存量
		开监视();
	});

	pi.on("session_shutdown", async () => {
		try {
			监视器?.close();
		} catch { /* ignore */ }
		监视器 = null;
	});
}
