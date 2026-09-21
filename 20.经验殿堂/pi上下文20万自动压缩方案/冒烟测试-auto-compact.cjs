// 配套脚本：auto-compact-200k 扩展的冒烟测试（假 pi API 驱动，不需要真跑模型）
//
// 干什么：验证扩展的四件事——①只在真正空闲时触发 ②同水位不重复触发 ③摘要撞上限时降思考重试一次
//         ④小窗口模型（如 128k）阈值自动降低；顺带核对「磁盘上的扩展」和「经验 md 里的代码」是否一致。
//
// 用法（在任意目录）：
//   node "D:\桌面\办公软件\20.经验大全\pi上下文20万自动压缩方案\冒烟测试-auto-compact.cjs"
//   可选：--ext <扩展路径>   默认 C:\Users\<你>\.pi\agent\extensions\auto-compact-200k.ts
//
// 只读：不写任何文件、不打印登录态；失败时退出码 1。
const fs = require("fs");
const os = require("os");
const path = require("path");

const PI_MODULES = path.join(os.homedir(), "AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent");
const { createJiti } = require(path.join(PI_MODULES, "node_modules/jiti"));
const jiti = createJiti(__filename);

const HERE = __dirname;
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const EXT = argOf("--ext", path.join(os.homedir(), ".pi/agent/extensions/auto-compact-200k.ts"));
const MD = path.join(HERE, "2026-09-09-pi上下文20万自动压缩方案迁移话术.md");

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}  得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`);
};

// ── 0. 漂移检查：扩展文件 vs 经验 md 里的代码块 ─────────────────────────────
function driftCheck() {
  if (!fs.existsSync(EXT)) return console.log(`! 找不到扩展文件（跳过漂移检查）：${EXT}`);
  if (!fs.existsSync(MD)) return console.log(`! 找不到经验 md（跳过漂移检查）：${MD}`);
  const md = fs.readFileSync(MD, "utf8");
  const block = (md.match(/```(?:ts|typescript)\n([\s\S]*?)```/) || [])[1];
  if (!block) return console.log("! 经验 md 里没有 ts 代码块（跳过漂移检查）");
  const norm = (s) => s.replace(/\r\n/g, "\n").trim();
  check("磁盘扩展 == 经验 md 代码块", norm(fs.readFileSync(EXT, "utf8")) === norm(block), true);
}

// ── 1~6：行为测试 ──────────────────────────────────────────────────────────
(async () => {
  console.log(`扩展：${EXT}\n经验：${MD}\n`);
  driftCheck();

  const mod = await jiti.import(EXT, { default: true });
  const handlers = {};
  const log = [];
  let thinking = "max";
  const pi = {
    on: (event, handler) => { (handlers[event] ||= []).push(handler); },
    getThinkingLevel: () => thinking,
    setThinkingLevel: (level) => { thinking = level; log.push("thinking=" + level); },
  };
  let compactCalls = 0;
  let pendingCallbacks = null;
  let usageTokens = 220_000;
  let idle = true;
  let windowSize = 1_000_000;

  const makeCtx = () => ({
    model: { contextWindow: windowSize },
    ui: { notify: (msg, level) => log.push(`${level}: ${msg}`) },
    getContextUsage: () => ({ tokens: usageTokens, contextWindow: windowSize }),
    isIdle: () => idle,
    compact: (options) => { compactCalls++; pendingCallbacks = options; },
  });
  let currentCtx = makeCtx();
  const fire = (event, arg) => (handlers[event] || []).forEach((h) => h(arg, currentCtx));

  mod(pi);
  console.log("注册事件:", Object.keys(handlers).join(", ") || "(无)");

  // 1. 空闲 + 220k → 触发一次
  fire("agent_settled", {});
  check("1) 空闲 220k 触发压缩", compactCalls, 1);

  // 2. 忙碌（run 未结束）→ 不触发（v3 的核心修复）
  idle = false;
  fire("agent_settled", {});
  check("2) 忙碌时不触发", compactCalls, 1);

  // 3. 摘要撞上限 → 降思考重试一次
  idle = true;
  pendingCallbacks.onError(new Error("Summarization failed: generation hit the token cap and the summary is incomplete"));
  fire("session_compact_failed", { aborted: false, errorMessage: "Compaction failed: summarization failed: generation hit the token cap and the summary is incomplete" });
  await new Promise((r) => setTimeout(r, 20));
  check("3) 撞上限后重试一次", compactCalls, 2);
  check("3) 重试时降思考", thinking, "off");

  // 4. 重试也撞上限 → 只报警，不再重试、不降级
  pendingCallbacks.onError(new Error("generation hit the token cap"));
  fire("session_compact_failed", { aborted: false, errorMessage: "token cap" });
  await new Promise((r) => setTimeout(r, 20));
  check("4) 第二次撞上限不再重试", compactCalls, 2);

  // 5. 压缩成功 + 同水位 → 不重复触发
  pendingCallbacks.onComplete({});
  fire("session_compact", {});
  fire("agent_settled", {});
  check("5) 同水位不重复触发", compactCalls, 2);

  // 6. 小窗口 128k → 阈值 = max(128k-65536, 64k) = 64k
  usageTokens = 50_000;
  windowSize = 128_000;
  currentCtx = makeCtx();
  fire("agent_settled", {});          // 回落，清基线
  usageTokens = 70_000;
  fire("agent_settled", {});
  check("6) 小窗口按窗口自适应触发", compactCalls, 3);

  console.log("\n--- 通知日志 ---");
  console.log(log.join("\n") || "(无)");
  console.log(failed ? `\n结果：${failed} 项未通过` : "\n结果：全部通过");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("跑挂了：", String(e)); process.exit(1); });
