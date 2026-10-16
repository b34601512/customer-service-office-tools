#!/usr/bin/env node
/**
 * 派活.cjs —— 把「重活」外包给本机的 CodeBuddy CLI（headless 模式）执行。
 *
 * 定位：AI 窗口当「大脑」，只负责编排与上下文；单个耗时的重活交给本机的
 *       CodeBuddy CLI 去跑，消耗 CodeBuddy 订阅额度，跑完把结果文本还给窗口。
 *       额度耗尽（退出码 2）时，调用方应「回落」——由窗口自己接着干。
 *
 * 用法：
 *   node 派活.cjs "<任务描述>" [--工作目录 <目录>] [--模型 <模型名>] [--超时 <秒>] [--安静]
 * 参数别名（等价）：
 *   --工作目录/--cwd   --模型/--model   --超时/--timeout   --安静/--quiet
 * 环境变量：
 *   CODEBUDDY_MODEL  默认模型（不传 --模型 时用）
 *   CODEBUDDY_CLI    CLI 的 JS 入口路径（自定义安装 / 测试用）
 *   CODEBUDDY_LOG    日志文件路径（默认本目录 派活日志.jsonl；运行时产物，别提交）
 *
 * 退出码（调用方照这个决定要不要回落、自己干）：
 *   0 = 成功（stdout 就是它的回复/干活结果文本）
 *   2 = 额度/积分用尽（insufficient credit/quota）→ 应回落，由调用方自己干
 *   3 = 未登录/登录失效（需重新登录 CodeBuddy）
 *   4 = 超时
 *   5 = 其它错误（网络、CLI 故障等；可重试或回落）
 *
 * 说明：默认带 -y（允许它直接改文件/跑命令干活），工作目录默认取当前目录；
 *      强烈建议显式指定 --工作目录，把它框在一个目录里干活。
 *      ⚠️ 执行方式：优先用 process.execPath 直跑 CLI 的 JS 入口——**不经 shell 拼串**，
 *      任务里的空格不会被拆词（Windows 上尤其重要；2026-10-16 复核实锤过 shell 拆参坑）。
 *      每次调用会在（可配的）日志文件里记一条（不记超长内容）。
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const 本目录 = __dirname;
const 日志文件 = process.env.CODEBUDDY_LOG
  ? path.resolve(process.env.CODEBUDDY_LOG)
  : path.join(本目录, "派活日志.jsonl");
// 默认模型：示例值，可用 --模型 或环境变量 CODEBUDDY_MODEL 覆盖
const 默认模型 = process.env.CODEBUDDY_MODEL || "deepseek-v4.1-flash";

// ---------- 参数 ----------
function 用法(错) {
  if (错) console.error("[派活] 参数有误：" + 错);
  console.error('用法：node 派活.cjs "<任务描述>" [--工作目录 <目录>] [--模型 <模型名>] [--超时 <秒>] [--安静]');
  process.exit(5);
}

const argv = process.argv.slice(2);
if (!argv.length || argv[0].startsWith("--")) 用法("缺少任务描述（第一个参数）");

const 任务 = argv[0];
let 工作目录 = process.cwd();
let 模型 = 默认模型;
let 超时秒 = 600;
let 安静 = false;

for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--工作目录" || a === "--cwd") 工作目录 = argv[++i] || "";
  else if (a === "--模型" || a === "--model") 模型 = argv[++i] || "";
  else if (a === "--超时" || a === "--timeout") 超时秒 = Number(argv[++i] || 0) || 600;
  else if (a === "--安静" || a === "--quiet") 安静 = true;
  else 用法("不认识的参数：" + a);
}
if (!fs.existsSync(工作目录)) 用法("工作目录不存在：" + 工作目录);

// ---------- 找 CodeBuddy CLI（首选 JS 入口——不经 shell，参数不拆词） ----------
// 装了 @tencent-ai/codebuddy-code 之后，npm 全局里会有：
//   · JS 入口：<npm全局根>/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy（用 node 直跑最稳）
//   · 命令垫片：PATH 上的 codebuddy / cbc（Windows 上常是 .cmd——经 shell 会拆参，尽量不用）
function 取JS入口(包目录) {
  // 1) 读 package.json 的 bin 映射（最准）——同目录有 cbc-prewarm、codebuddy-lowmem 等
  //    多个可执行文件，绝不能盲扫「第一个无扩展名文件」（2026-10-16 真连踩过）
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(包目录, "package.json"), "utf8"));
    const bin = pkg.bin;
    let 候选值 = [];
    if (typeof bin === "string") 候选值 = [bin];
    else if (bin && typeof bin === "object") {
      候选值 = [bin.codebuddy, bin.cbc, ...Object.values(bin)].filter((v) => typeof v === "string");
    }
    for (const 值 of 候选值) {
      const p = path.join(包目录, 值);
      try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
    }
  } catch (_) {}
  // 2) 兜底：bin 目录里按名精确找 codebuddy / cbc
  const bin目录 = path.join(包目录, "bin");
  for (const 名 of ["codebuddy", "cbc"]) {
    const p = path.join(bin目录, 名);
    try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return "";
}

function 扫目录找可执行(目录, 名字) {
  const 扩展 = process.platform === "win32"
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((x) => x.toLowerCase()).filter(Boolean).concat([""])
    : [""];
  for (const ext of 扩展) {
    const p = path.join(目录, 名字 + ext);
    try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return "";
}

function 在PATH里找(名字) {
  const 目录们 = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const d of 目录们) {
    const hit = 扫目录找可执行(d, 名字);
    if (hit) return hit;
  }
  return "";
}

// 返回 { 入口, 经壳 }；经壳=true 只在「只有 .cmd/.bat 垫片、推不出 JS 入口」时出现（最后手段）
function 找CLI() {
  // 0) 显式指定（自定义安装 / 测试用）
  const 指定 = process.env.CODEBUDDY_CLI;
  if (指定) {
    if (fs.existsSync(指定)) return { 入口: 指定, 经壳: false };
    console.error("[派活] CODEBUDDY_CLI 指向的文件不存在：" + 指定);
    return { 入口: "", 经壳: false };
  }
  const 家 = os.homedir();
  const 根目录们 = [];
  // 1) 常见 npm 全局 node_modules
  if (process.platform === "win32") {
    if (process.env.APPDATA) 根目录们.push(path.join(process.env.APPDATA, "npm", "node_modules"));
    根目录们.push(path.join(家, "AppData", "Roaming", "npm", "node_modules"));
  } else {
    根目录们.push(path.join(家, ".npm-global", "lib", "node_modules"));
    根目录们.push("/usr/local/lib/node_modules", "/usr/lib/node_modules");
  }
  // 2) 再兜一层：问 npm 全局根目录
  try {
    const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], {
      encoding: "utf8", timeout: 15000, windowsHide: true,
    });
    if (r.status === 0 && r.stdout) 根目录们.push(r.stdout.trim());
  } catch (_) {}

  // 首选：npm 全局根里的 JS 入口
  for (const 根 of 根目录们) {
    const 入口 = 取JS入口(path.join(根, "@tencent-ai", "codebuddy-code"));
    if (入口) return { 入口, 经壳: false };
  }
  // 兜底：PATH 上的命令垫片
  for (const 名字 of ["codebuddy", "cbc"]) {
    const hit = 在PATH里找(名字);
    if (!hit) continue;
    if (!/\.(cmd|bat)$/i.test(hit)) return { 入口: hit, 经壳: false };
    // .cmd/.bat：先从垫片同级位置推导 JS 入口（npm 垫片与包目录相邻）
    for (const 根 of [path.join(path.dirname(hit), "node_modules"), path.dirname(hit)]) {
      const 入口 = 取JS入口(path.join(根, "@tencent-ai", "codebuddy-code"));
      if (入口) return { 入口, 经壳: false };
    }
    return { 入口: hit, 经壳: true }; // 最后手段：经壳（下方给每个参数加引号防拆词）
  }
  return { 入口: "", 经壳: false };
}

const { 入口: cli, 经壳 } = 找CLI();
if (!cli) {
  console.error("[派活] 找不到 CodeBuddy CLI（codebuddy/cbc）。请先安装 @tencent-ai/codebuddy-code，或用环境变量 CODEBUDDY_CLI 指定其 JS 入口。");
  记日志({ 退出码: 5, 错误: "找不到 CLI" });
  process.exit(5);
}

// ---------- 跑 ----------
const 起点 = Date.now();
const 参数 = ["-p", 任务, "--model", 模型, "--output-format", "json", "-y"];
let 结果;
if (!经壳) {
  // 正路：node 直跑 JS 入口——参数原样传递，带空格的任务不会被拆词
  结果 = spawnSync(process.execPath, [cli, ...参数], {
    cwd: 工作目录,
    env: { ...process.env, PATH: (process.env.PATH || "") + path.delimiter + (process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "") },
    timeout: 超时秒 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
    windowsHide: true,
  });
} else {
  // 最后手段：只有 .cmd/.bat 垫片可用时经 shell 跑；参数逐个加引号防拆词
  // （主要面向 Windows 的 .cmd 垫片；能走到这里说明没找到 JS 入口，建议改用 CODEBUDDY_CLI 指定）
  const 加引号 = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const 命令行 = [加引号(cli), ...参数.map(加引号)].join(" ");
  结果 = spawnSync(命令行, {
    cwd: 工作目录,
    shell: true,
    timeout: 超时秒 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
    windowsHide: true,
  });
}
const 用时 = Date.now() - 起点;

// ---------- 解析（headless 的 --output-format json 输出；数组 / 单对象都收） ----------
function 解析JSON(文本) {
  if (!文本) return null;
  try { return JSON.parse(文本); } catch (_) {}
  const i = 文本.indexOf("["), j = 文本.lastIndexOf("]");
  if (i >= 0 && j > i) { try { return JSON.parse(文本.slice(i, j + 1)); } catch (_) {} }
  const a = 文本.indexOf("{"), b = 文本.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(文本.slice(a, b + 1)); } catch (_) {} }
  return null;
}

let 结果文本 = ""; // type=result 里的文本
let 助手文本 = ""; // assistant message 里的文本
let 元 = {};
let 错误文本 = "";
const 数据 = 解析JSON(结果.stdout);
// 数组 / 单对象统一按「条目列表」处理
const 条目 = Array.isArray(数据) ? 数据 : (数据 && typeof 数据 === "object" ? [数据] : []);
for (const m of 条目) {
  if (!m || typeof m !== "object") continue;
  if (m.type === "result" || typeof m.result === "string") {
    元 = m;
    if (typeof m.result === "string" && m.result) 结果文本 = m.result;
    if (m.is_error) 错误文本 += "\n" + String(m.result || "");
  } else if (m.type === "message" && (m.role === "assistant" || !m.role)) {
    const c = m.content;
    let t = "";
    if (Array.isArray(c)) t = c.map((x) => (x && typeof x.text === "string" ? x.text : "")).join("");
    else if (typeof c === "string") t = c;
    if (t) 助手文本 = t;
  }
}
// 固定优先级（README 约定）：message 覆盖文本；result 提供元信息并判 is_error
const 回复文本 = 助手文本 || 结果文本;
if (!条目.length) 错误文本 += (结果.stdout || "") + "\n" + (结果.stderr || "");
if (!回复文本 && typeof 结果.stdout === "string" && !数据 && 结果.status === 0) {
  // 兜底：没有任何结构可解析时，把 stdout 当纯文本
  错误文本 = String(结果.stderr || "");
}
const 纯文本兜底 = !回复文本 && typeof 结果.stdout === "string" && !数据 && 结果.status === 0 ? 结果.stdout.trim() : "";
if (!错误文本) 错误文本 = String(结果.stderr || "");

// ---------- 定性（退出码语义） ----------
function 含(文本, 词表) {
  const t = String(文本 || "").toLowerCase();
  return 词表.some((w) => t.includes(w));
}

const 成功 = 结果.status === 0 && !!(回复文本 || 纯文本兜底) && !(元 && 元.is_error);
let 退出码 = 5;
let 说明 = "";
if (结果.error && /ETIMEDOUT|timed out/i.test(String(结果.error.message))) { 退出码 = 4; 说明 = "超时（" + 超时秒 + "秒）"; }
else if (结果.error) { 退出码 = 5; 说明 = "进程错误：" + 结果.error.message; }
else if (含(错误文本, ["authentication required", "please login", "not logged in", "unauthorized"])) { 退出码 = 3; 说明 = "未登录/登录失效"; }
else if (含(错误文本, ["insufficient", "quota", "credit", "balance", "额度", "积分不足", "余额不足", "exceeded", "limit reached", "payment required"]) && !成功) {
  退出码 = 2; 说明 = "额度/积分用尽";
}
else if (成功) { 退出码 = 0; 说明 = "成功"; }
else if (!回复文本 && !(元 && 元.is_error)) { 退出码 = 5; 说明 = "它没给结果（退出码 " + 结果.status + "）"; }
else { 退出码 = 5; 说明 = "其它错误"; }

// ---------- 日志 ----------
function 记日志(x) {
  try {
    const 行 = JSON.stringify({
      时间: new Date().toISOString(),
      工作目录,
      模型,
      任务: 任务.slice(0, 80),
      退出码: x.退出码,
      用时毫秒: x.用时毫秒 || 0,
      credit: (x.元 && x.元.usage && x.元.usage.credit) || null,
      cost_usd: (x.元 && x.元.total_cost_usd) || 0,
      结果: (x.回复文本 || "").slice(0, 120),
      错误: (x.错误 || "").slice(0, 200),
    });
    fs.appendFileSync(日志文件, 行 + "\n");
  } catch (_) {}
}
记日志({ 退出码, 用时毫秒: 用时, 元, 回复文本: 回复文本 || 纯文本兜底, 错误: 说明 + " | " + 错误文本 });

// ---------- 输出 ----------
if (退出码 === 0) {
  process.stdout.write(((回复文本 || 纯文本兜底) || "").trim() + "\n");
  if (!安静) console.error(`[派活] 成功　用时 ${(用时 / 1000).toFixed(1)} 秒　模型 ${模型}`);
  process.exit(0);
} else {
  if (回复文本) process.stdout.write(回复文本 + "\n");
  console.error(`[派活] 失败（退出码 ${退出码}）：${说明}`);
  if (错误文本.trim() && !安静) console.error("[派活] 原始报错（节选）：" + 错误文本.trim().slice(0, 300));
  process.exit(退出码);
}
