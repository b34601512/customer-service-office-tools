#!/usr/bin/env node
"use strict";

/**
 * pi 窗口心跳写手（27号）—— 每个 pi 窗口一条，窗口死了写手就停，心跳自然过期。
 *
 * 背景（2026-10-09 黎路遥拍板，Grok Bot 转达；赵敏/程灵素已对齐机制）：
 * - 窗口挂了（进程不在 / 长时间无心跳）要能在机器人留言板发 [故障]，但**死窗口自己报不了自己**，
 *   所以写手必须随窗口同生共死，由独立的 5 分钟看门狗（企微看门狗.js）来判、来报。
 * - 三条对齐要点：①写手随窗口同生共死（窗口挂＝写手停、心跳过期）②同一故障 60 分钟内不重报，
 *   恢复发 [已解决] ③上次关机残留忽略（心跳早于本次开机→不判挂）+ 开机 30 分钟宽限。
 *
 * 认窗口径（2026-10-01 关任务窗的教训）：**认真实 pi 进程，不用登记里的包装壳 pid**——
 * 登记 pid 是 pi.cmd 包装壳（如 13556），真实 pi 是 node.exe、CommandLine 含 `pi-coding-agent`。
 * 本写手用 PowerShell `Get-CimInstance Win32_Process` 扫出真实 pid；认不到（0 或 >1 个）
 * 短暂重试后退出、**不写心跳、不硬编 pid**。
 *
 * 用法：
 *   node scripts/窗口心跳.cjs --认窗 "<匹配串>" [--认窗 "<再一条，全部包含才算>"] \
 *        --名 "<窗口名>" [--类型 listener|task] [--间隔 150] [--后台]
 *   # --后台：拉起一个脱离本进程的副本后立刻返回（监听窗/任务窗在 shell 里挂心跳用这条）
 *   # 演练：--拍数 <N> 只写 N 拍就退出；--状态文件/--日志文件 指到临时目录（别碰生产 .state）
 *
 * 记录落盘：默认 27号/.state/窗口心跳.json，多窗并发写用「读写锁 + 临时文件 rename 原子替换」防打架：
 *   { 更新At, 窗口: { "<认窗[0]>": {名, 类型, pid, 认窗:[...], 启动时间, 最后心跳} } }
 *
 * 单实例锁（2026-10-09 自愈补写手）：每个窗口一把（<状态文件目录>/窗口心跳锁/<sha1>.json），
 *   同窗已有活写手时本写手自动退出；每拍刷新，正常退出释放。看门狗补写手前也先查这把锁。
 *
 * 判定/报警不在这里：见 src/窗口心跳判定.js（纯函数）与 scripts/企微看门狗.js（5 分钟一跑）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const 默认状态文件 = path.join(ROOT, ".state", "窗口心跳.json");
const 默认日志文件 = path.join(ROOT, ".state", "窗口心跳.log");
const 默认间隔秒 = 150; // 与看门狗 10 分钟阈值配套：150s 一拍，掉 2 拍才会"超时"
const 默认认窗超时秒 = 60; // 窗口刚开时 pi 进程可能还没起来，给它 60 秒

// ---------------------------------------------------------------- 基础工具

function 进程在(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function 同步睡(毫秒) {
  // 用于锁竞争等待；无 Worker 也安全。
  const 缓冲 = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(缓冲, 0, 0, 毫秒);
}

function 记日志(日志文件, 文本) {
  const 行 = `[${new Date().toISOString()}] ${文本}`;
  console.log(行);
  if (!日志文件) return;
  try {
    fs.mkdirSync(path.dirname(日志文件), { recursive: true });
    if (fs.existsSync(日志文件) && fs.statSync(日志文件).size > 1024 * 1024) fs.renameSync(日志文件, 日志文件 + ".1");
    fs.appendFileSync(日志文件, 行 + "\n", "utf8");
  } catch {
    /* 日志写不进去不影响心跳 */
  }
}

// ---------------------------------------------------------------- 认窗（PS 扫真实 pi 进程）

/** 解析扫描输出：`pid|开始|命令行`（命令行里可能有 `|`，只切前两刀）。 */
function 解析进程行(文本) {
  return String(文本 || "")
    .split(/\r?\n/)
    .map((行) => 行.trim().replace(/^\uFEFF/, ""))
    .filter((行) => /^\d+\|\d/.test(行))
    .map((行) => {
      const [pid, 开始, ...余] = 行.split("|");
      return { pid: Number(pid), 开始, 命令行: 余.join("|") };
    })
    .filter((x) => Number.isFinite(x.pid) && x.pid > 0);
}

/** 认窗匹配（纯函数）：命令行必须包含全部匹配串。 */
function 认窗匹配(列表, 认窗组) {
  const 组 = (Array.isArray(认窗组) ? 认窗组 : [认窗组]).map((x) => String(x || "")).filter(Boolean);
  if (组.length === 0) return [];
  return (列表 || []).filter((p) => 组.every((串) => String(p.命令行 || "").includes(串)));
}

/**
 * 扫机器上的真实 pi 进程（node.exe 且 CommandLine 含 pi-coding-agent）。
 * 返回 { ok, 列表 } 或 { ok:false, 错误 } —— ok=false 时调用方**不许**当成"进程全不在"（免得误报）。
 * 实现照 0号档案 关任务窗.cjs：临时 ps1 + 输出走 UTF-8 文件（中文路径直接走管道会乱码）。
 */
function 扫pi进程({ 执行 = null } = {}) {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), "心跳扫-"));
  const 脚本文件 = path.join(临时目录, "扫.ps1");
  const 输出文件 = path.join(临时目录, "出.txt");
  const 脚本 = [
    "$all = Get-CimInstance Win32_Process",
    "$pis = $all | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*pi-coding-agent*' }",
    "$pis | ForEach-Object {",
    '  $t = $_.CreationDate.ToString("yyyy-MM-dd HH:mm:ss")',
    '  "$($_.ProcessId)|$t|$($_.CommandLine)"',
    "} | Out-File -FilePath \"" + 输出文件 + "\" -Encoding utf8",
  ].join("\n");
  try {
    fs.writeFileSync(脚本文件, "\uFEFF" + 脚本, "utf8"); // BOM：PowerShell 5.1 才会按 UTF-8 读
    const 跑 = 执行 || ((f) => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", f], { stdio: "ignore", windowsHide: true, timeout: 30000 }));
    跑(脚本文件);
    return { ok: true, 列表: 解析进程行(fs.readFileSync(输出文件, "utf8")) };
  } catch (e) {
    return { ok: false, 错误: String((e && e.message) || e) };
  } finally {
    try {
      fs.rmSync(临时目录, { recursive: true, force: true });
    } catch {
      /* 临时目录删不掉不影响 */
    }
  }
}

/**
 * 找这个窗口的真实 pi 进程。必须**唯一命中**：0 个（没起来）或 >1 个（说不清是哪个）
 * 都算认不到——返回 { ok:false }，绝不用第一个或硬编 pid 糊弄。
 */
function 找窗口(认窗组, { 扫描 = 扫pi进程 } = {}) {
  const r = 扫描();
  if (!r || r.ok !== true) return { ok: false, 原因: `进程扫描失败：${(r && r.错误) || "未知"}` };
  const 命中 = 认窗匹配(r.列表, 认窗组);
  if (命中.length === 0) return { ok: false, 原因: "没找到匹配的 pi 进程" };
  if (命中.length > 1) return { ok: false, 原因: `匹配到 ${命中.length} 个 pi 进程（说不清是哪个）：${命中.map((x) => x.pid).join(",")}` };
  return { ok: true, 进程: 命中[0] };
}

// ---------------------------------------------------------------- 记录落盘（锁 + 原子替换）

function 空台账() {
  return { 更新At: null, 窗口: {} };
}

function 读心跳(文件 = 默认状态文件) {
  try {
    const j = JSON.parse(fs.readFileSync(文件, "utf8"));
    if (j && typeof j === "object" && j.窗口 && typeof j.窗口 === "object") return j.窗口;
    return {};
  } catch {
    return {};
  }
}

function 原子写(文件, 文本) {
  fs.mkdirSync(path.dirname(文件), { recursive: true });
  const 临时 = `${文件}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(临时, 文本, "utf8");
  fs.renameSync(临时, 文件); // Windows 上 Node 的 rename 会覆盖已存在文件
}

/** 简单读写锁：wx 独占创建；占用者已死或锁太旧（>30s）就接管。拿不到锁返回 null（这一拍跳过，下一拍再来）。 */
function 带锁(锁文件, 干活, { 等待毫秒 = 2000 } = {}) {
  const 起 = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(锁文件, "wx");
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") return null;
      if (Date.now() - 起 > 等待毫秒) return null;
      let 陈旧 = false;
      try {
        const rec = JSON.parse(fs.readFileSync(锁文件, "utf8"));
        陈旧 = !rec || !rec.pid || !进程在(rec.pid) || Date.now() - Number(rec.at || 0) > 30000;
      } catch {
        陈旧 = true;
      }
      if (陈旧) {
        try { fs.unlinkSync(锁文件); } catch { /* 别人先删了就算了 */ }
        continue;
      }
      同步睡(50);
    }
  }
  try {
    return 干活();
  } finally {
    try { fs.unlinkSync(锁文件); } catch { /* 锁丢了不影响结果 */ }
  }
}

/** 写入/更新本窗口的心跳条目（以 认窗[0] 为键）。拿不到锁返回 false（写手下一拍重试）。 */
function 写心跳条目(文件, 条目, { 现在 = () => Date.now() } = {}) {
  const 结果 = 带锁(path.join(文件 + ".lock"), () => {
    let 旧;
    try {
      旧 = JSON.parse(fs.readFileSync(文件, "utf8"));
    } catch {
      旧 = null;
    }
    const 全 = { ...空台账(), ...(旧 && typeof 旧 === "object" ? 旧 : {}), 窗口: { ...((旧 && 旧.窗口) || {}) } };
    const 键 = (Array.isArray(条目.认窗) ? 条目.认窗[0] : 条目.认窗) || 条目.名;
    全.窗口[键] = 条目;
    全.更新At = new Date(现在()).toISOString();
    原子写(文件, JSON.stringify(全, null, 1));
    return true;
  });
  return 结果 === true;
}

/** 按谓词清心跳条目（正常收窗时用）；返回清掉几个。没命中就不改写文件（避免碰无关窗口）。 */
function 清心跳(文件, 谓词, { 现在 = () => Date.now() } = {}) {
  const 结果 = 带锁(path.join(文件 + ".lock"), () => {
    let 全;
    try {
      全 = JSON.parse(fs.readFileSync(文件, "utf8"));
    } catch {
      return 0;
    }
    if (!全 || typeof 全 !== "object" || !全.窗口 || typeof 全.窗口 !== "object") return 0;
    let 清掉 = 0;
    for (const [键, 记录] of Object.entries(全.窗口)) {
      if (谓词(记录, 键)) {
        delete 全.窗口[键];
        清掉++;
      }
    }
    if (清掉 > 0) {
      全.更新At = new Date(现在()).toISOString();
      原子写(文件, JSON.stringify(全, null, 1));
    }
    return 清掉;
  });
  return 结果 == null ? 0 : 结果;
}

// ---------------------------------------------------------------- 单实例锁（同一个窗口只许一个写手）

/**
 * 单实例锁（2026-10-09 窗口心跳自愈·补写手）：
 * 看门狗发现「进程在、心跳停」会补写手；人工/开机也可能同时重挂。两个写手同窗并跑会
 * 互相覆盖、退出时互删锁——所以每个写手启动时先认领**本窗**的锁：
 *   - 已有同窗活锁（pid 在 + 锁新鲜）→ 本写手直接退出，不写心跳；
 *   - 锁陈旧（pid 不在 / pid 被别的进程复用）→ 接管；
 *   - 每拍刷新 更新At；正常退出只删自己的锁。
 * 锁按窗口分（不是全局唯一）：`<状态文件目录>/窗口心跳锁/<sha1(认窗[0])>.json`，
 * 内容 { 名, 键, pid, 启动At, 更新At }。
 */
const 默认锁新鲜毫秒 = 6 * 60 * 1000; // 写手每拍（默认 150s）刷新；6 分钟没刷新视为锁可能死了

function 规整锁键(键) {
  return String(键 || "").trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function 锁目录(状态文件 = 默认状态文件) {
  return path.join(path.dirname(状态文件), "窗口心跳锁");
}

/** 本窗锁文件（按 认窗[0] 归一化后取 sha1，避免中文/路径字符进文件名）。 */
function 单例锁文件(状态文件, 键) {
  const 摘要 = crypto.createHash("sha1").update(规整锁键(键)).digest("hex").slice(0, 16);
  return path.join(锁目录(状态文件 || 默认状态文件), 摘要 + ".json");
}

function 读单例锁(锁文件) {
  try {
    const rec = JSON.parse(fs.readFileSync(锁文件, "utf8"));
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    return null;
  }
}

/** 查单个 pid 的命令行（写手身份核验用）。返回行文本或 null（查不到/失败）。 */
function 查进程行(pid) {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), "写手核验-"));
  const 脚本文件 = path.join(临时目录, "查.ps1");
  const 输出文件 = path.join(临时目录, "出.txt");
  const 脚本 = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"`,
    'if ($p) { "$($p.ProcessId)|$($p.Name)|$($p.CommandLine)" | Out-File -FilePath "' + 输出文件 + '" -Encoding utf8 }',
  ].join("\n");
  try {
    fs.writeFileSync(脚本文件, "\uFEFF" + 脚本, "utf8");
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", 脚本文件], { stdio: "ignore", windowsHide: true, timeout: 15000 });
    return fs.readFileSync(输出文件, "utf8").trim() || null;
  } catch {
    return null;
  } finally {
    try { fs.rmSync(临时目录, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
}

/** 这个 pid 是不是心跳写手进程。true=是；false=不是；null=查不清楚（不冒进）。 */
function 是写手进程(pid, { 查询 = 查进程行 } = {}) {
  const 行 = 查询(pid);
  if (行 == null) return null;
  return /node\.exe/i.test(行) && 行.includes("窗口心跳.cjs") ? true : false;
}

/**
 * 锁活跃吗：pid 在 + 锁新鲜就是活跃；锁旧了但 pid 还在，核验它是不是真的写手——
 * 真的（或查不清）算活跃（宁可等，也不双开）；pid 被别的进程复用才算死、可接管。
 */
function 单例锁活跃(锁文件, { 现在 = () => Date.now(), 新鲜毫秒 = 默认锁新鲜毫秒, 核验 = 是写手进程 } = {}) {
  const rec = 读单例锁(锁文件);
  if (!rec || !rec.pid || !进程在(rec.pid)) return false;
  const 刷新At = Number(rec.更新At || rec.at || 0);
  if (Number.isFinite(刷新At) && 现在() - 刷新At <= 新鲜毫秒) return true;
  return 核验(rec.pid) !== false;
}

/** 认领本窗锁：成功 true / 已有活锁拿不到 false。陈旧锁会安全接管。 */
function 认领单例锁(锁文件, { 名 = "", 键 = "", pid = process.pid, 现在 = () => Date.now(), 新鲜毫秒 = 默认锁新鲜毫秒, 核验 = 是写手进程, 等待毫秒 = 2000 } = {}) {
  fs.mkdirSync(path.dirname(锁文件), { recursive: true });
  const 起 = 现在();
  for (;;) {
    try {
      const fd = fs.openSync(锁文件, "wx");
      fs.writeSync(fd, JSON.stringify({ 名, 键, pid, 启动At: new Date(现在()).toISOString(), 更新At: 现在() }));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e && e.code !== "EEXIST") return false;
      if (!单例锁活跃(锁文件, { 现在, 新鲜毫秒, 核验 })) {
        try { fs.unlinkSync(锁文件); } catch { /* 别人先删了 */ }
        continue; // 接管，下一圈重建
      }
      if (现在() - 起 > 等待毫秒) return false;
      同步睡(150);
    }
  }
}

/** 刷新自己的锁（每拍调一次）。锁不是自己的就不动。 */
function 刷新单例锁(锁文件, { pid = process.pid, 现在 = () => Date.now() } = {}) {
  const rec = 读单例锁(锁文件);
  if (!rec || Number(rec.pid) !== Number(pid)) return false;
  rec.更新At = 现在();
  原子写(锁文件, JSON.stringify(rec));
  return true;
}

/** 释放自己的锁（正常退出时调）。 */
function 释放单例锁(锁文件, { pid = process.pid } = {}) {
  const rec = 读单例锁(锁文件);
  if (!rec || Number(rec.pid) !== Number(pid)) return false;
  try { fs.unlinkSync(锁文件); return true; } catch { return false; }
}

// ---------------------------------------------------------------- 参数与主循环

function 解析参数(argv) {
  const 参数 = {
    认窗: [],
    名: "",
    类型: "task",
    间隔秒: 默认间隔秒,
    认窗超时秒: 默认认窗超时秒,
    状态文件: 默认状态文件,
    日志文件: 默认日志文件,
    后台: false,
    拍数: null,
    帮助: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--认窗") 参数.认窗.push(String(argv[++i] || ""));
    else if (a === "--名") 参数.名 = String(argv[++i] || "");
    else if (a === "--类型") 参数.类型 = String(argv[++i] || "task");
    else if (a === "--间隔") { const v = Number(argv[++i]); 参数.间隔秒 = Number.isFinite(v) && v > 0 ? v : 默认间隔秒; }
    else if (a === "--认窗超时") { const v = Number(argv[++i]); 参数.认窗超时秒 = Number.isFinite(v) && v >= 0 ? v : 默认认窗超时秒; }
    else if (a === "--状态文件") 参数.状态文件 = path.resolve(String(argv[++i] || ""));
    else if (a === "--日志文件") 参数.日志文件 = path.resolve(String(argv[++i] || ""));
    else if (a === "--后台") 参数.后台 = true;
    else if (a === "--拍数") { const v = Number(argv[++i]); 参数.拍数 = Number.isFinite(v) && v > 0 ? v : null; }
    else if (a === "--help" || a === "-h") 参数.帮助 = true;
    else {
      console.error(`未知参数：${a}（--help 看用法）`);
      process.exit(2);
    }
  }
  return 参数;
}

function 用法() {
  return `窗口心跳写手（27号）—— 每 150 秒给本窗口记一拍心跳，窗口死了写手就停。
用法：node scripts/窗口心跳.cjs --认窗 "<匹配串>" [--认窗 "<再一条>"] --名 "<窗口名>" [--类型 listener|task] [--间隔 150] [--后台]
  挂监听窗：  --认窗 "27.企业微信机器人" --认窗 "boot-prompt.md" --名 监听窗 --类型 listener
  挂任务窗：  --认窗 "@<任务文件全路径>" --名 "任务窗·<文件名>" --类型 task
  演练：--拍数 3 --间隔 1 --状态文件 <临时目录>/窗口心跳.json
单实例锁：每个窗口一把（<状态文件目录>/窗口心跳锁/）；已有同窗活写手时本写手自动退出，
  看门狗补写手前也先查这把锁，绝不并发起两个写手。
判定提醒：认窗必须**唯一**命中真实 pi 进程；0 个或 >1 个都会重试后退出，不写心跳。`;
}

/**
 * 主循环：先认窗（重试到 --认窗超时），再每 间隔秒 一拍；
 * 每拍先查认到的 pid 还在不在——不在**立刻停写退出**，记录留为过期（看门狗会报）。
 * 可注入 扫描/现在/睡眠，便于测试（用假进程，不许动真实窗口）。
 */
async function 主循环({
  认窗组,
  名 = "未命名窗口",
  类型 = "task",
  间隔秒 = 默认间隔秒,
  状态文件 = 默认状态文件,
  日志文件 = 默认日志文件,
  扫描 = 扫pi进程,
  现在 = () => Date.now(),
  睡眠 = (毫秒) => new Promise((r) => setTimeout(r, 毫秒)),
  认窗超时秒 = 默认认窗超时秒,
  拍数 = null,
  锁文件 = null,
} = {}) {
  const 组 = (Array.isArray(认窗组) ? 认窗组 : [认窗组]).map(String).filter(Boolean);
  if (组.length === 0) return { 退出: "没给 --认窗", 写拍数: 0 };

  // 0) 单实例锁：同窗只许一个写手（看门狗补写手 / 人工重挂同时来时，后到的退出，不双开）
  const 锁 = 锁文件 || 单例锁文件(状态文件, 组[0]);
  if (!认领单例锁(锁, { 名, 键: 组[0] })) {
    记日志(日志文件, `${名}：已有同窗心跳写手在跑（锁 ${锁}），本写手退出，不重复写`);
    return { 退出: "已有写手", 写拍数: 0 };
  }
  try {
    // 1) 认窗：0 个/多个都重试，超时后退出且不写心跳
    const 截止 = 现在() + 认窗超时秒 * 1000;
    let 进程 = null;
    let 最后原因 = "";
    for (;;) {
      const r = 找窗口(组, { 扫描 });
      if (r.ok) {
        进程 = r.进程;
        break;
      }
      最后原因 = r.原因;
      if (现在() >= 截止) {
        记日志(日志文件, `${名}（${类型}）认不到窗口：${最后原因} → 退出，不写心跳（看门狗会按无记录判）`);
        return { 退出: "认不到窗口：" + 最后原因, 写拍数: 0 };
      }
      await 睡眠(Math.min(5000, Math.max(0, 截止 - 现在())));
    }

    const 记 = (最后心跳) => ({
      名,
      类型,
      pid: 进程.pid,
      认窗: 组,
      启动时间: new Date(现在()).toISOString(),
      最后心跳: new Date(最后心跳).toISOString(),
    });
    const 写一拍 = (首拍) => {
      const 条目 = 记(现在());
      // 后续拍保留首次的启动时间
      if (!首拍) {
        const 旧 = 读心跳(状态文件)[组[0]];
        if (旧 && 旧.启动时间) 条目.启动时间 = 旧.启动时间;
      }
      return 写心跳条目(状态文件, 条目, { 现在 });
    };

    if (!写一拍(true)) 记日志(日志文件, `${名}（pid ${进程.pid}）首拍写盘失败（锁竞争？），下一拍重试`);
    else 记日志(日志文件, `${名}（${类型}）心跳启动：认到 pi pid=${进程.pid}，每 ${间隔秒}s 一拍 → ${状态文件}`);

    let 写拍数 = 1;
    for (let i = 1; 拍数 == null || i < 拍数; i++) {
      await 睡眠(间隔秒 * 1000);
      刷新单例锁(锁, { 现在 });
      const r = 找窗口(组, { 扫描 });
      if (!r.ok || r.进程.pid !== 进程.pid) {
        记日志(日志文件, `${名} 停写退出：${r.ok ? `认窗 pid 变了（${进程.pid} → ${r.进程.pid}）` : r.原因}；记录留为过期，等看门狗报警`);
        return { 退出: r.ok ? "认窗 pid 变了" : r.原因, 写拍数 };
      }
      if (写一拍(false)) 写拍数++;
    }
    return { 退出: "演练结束", 写拍数 };
  } finally {
    释放单例锁(锁);
  }
}

// ---------------------------------------------------------------- CLI

async function main() {
  const argv = process.argv.slice(2);
  const 参数 = 解析参数(argv);
  if (参数.帮助 || !参数.认窗.length || !参数.名) {
    console.log(参数.帮助 ? 用法() : "缺少 --认窗 / --名（--help 看用法）");
    process.exit(参数.帮助 ? 0 : 2);
  }
  const 类型 = 参数.类型 === "listener" ? "listener" : "task";
  if (参数.后台) {
    const 预锁 = 单例锁文件(参数.状态文件, 参数.认窗[0]);
    if (单例锁活跃(预锁)) {
      console.log(`${参数.名} 已有心跳写手在跑，跳过（不重复起；锁 ${预锁}）`);
      return;
    }
    const 子参数 = argv.filter((a) => a !== "--后台");
    const 子 = spawn(process.execPath, [__filename, ...子参数], { detached: true, stdio: "ignore", windowsHide: true, cwd: process.cwd() });
    子.unref();
    console.log(`${参数.名} 心跳写手已后台启动（pid ${子.pid}）`);
    return;
  }
  const 结果 = await 主循环({
    认窗组: 参数.认窗,
    名: 参数.名,
    类型,
    间隔秒: 参数.间隔秒,
    状态文件: 参数.状态文件,
    日志文件: 参数.日志文件,
    认窗超时秒: 参数.认窗超时秒,
    拍数: 参数.拍数,
  });
  if (结果.退出.startsWith("认不到窗口")) process.exitCode = 3;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("窗口心跳异常：" + (err && err.message ? err.message : err));
    process.exitCode = 1;
  });
}

module.exports = {
  默认状态文件,
  默认日志文件,
  解析参数,
  解析进程行,
  认窗匹配,
  扫pi进程,
  找窗口,
  读心跳,
  写心跳条目,
  清心跳,
  带锁,
  原子写,
  主循环,
  进程在,
  默认锁新鲜毫秒,
  规整锁键,
  锁目录,
  单例锁文件,
  读单例锁,
  查进程行,
  是写手进程,
  单例锁活跃,
  认领单例锁,
  刷新单例锁,
  释放单例锁,
};
