#!/usr/bin/env node
"use strict";

/**
 * 企微守护「看门狗」（27号）—— 独立于 pi 窗口与长连接守护的巡检程序。
 *
 * 为什么要有它（2026-10-06 漏消息研究结论）：
 * - 本机 SDK 被顶掉 / 静默失效后，进程还活着但永久收不到消息；企微长连接没有补推，只能尽早发现；
 * - 单聊一直有消息会"喂饱"看门狗 → 群 / 单聊分开计时；具体阈值与理由见 src/watchdog.js 头注释。
 *
 * 用法：
 *   node scripts/企微看门狗.js                 # 正式巡检（由计划任务 wecom-daemon-watchdog 每 5 分钟调用）
 *   node scripts/企微看门狗.js --dry-run       # 只判定并打印，不写文件/留言板/不重启
 *   node scripts/企微看门狗.js --no-board      # 不写留言板（演练用）
 *   node scripts/企微看门狗.js --no-restart    # 不重启守护（演练用，避免动生产进程）
 *   node scripts/企微看门狗.js --state-dir <目录>  # 用假状态跑演练（配合 --no-restart）
 *   node scripts/企微看门狗.js --no-heartbeat      # 本轮不查窗口心跳（演练用）
 *   node scripts/企微看门狗.js --心跳-记录 <文件> --心跳-任务窗 <文件> --开机时刻 <ISO>  # 窗口心跳演练
 *
 * 窗口心跳（2026-10-09 黎路遥拍板；赵敏/程灵素对齐）：pi 窗口挂（进程不在/长时间无心跳）→ 板贴 [故障]；
 *   写手在 scripts/窗口心跳.cjs（随窗口同生共死）、判定在 src/窗口心跳判定.js（纯函数）。
 *   本看门狗是 5 分钟一跑的独立进程，是“死窗口自己报不了自己”的报警人。
 *
 * 产物（默认都在 27号/.state/；`.state` 已 gitignore）：
 *   看门狗.log          本轮巡检记录（>1MB 轮转 .1）
 *   看门狗状态.json     最近状态 + 连续命中次数 + 告警状态（监听窗可定时读）
 *   看门狗待发留言.jsonl 留言板写失败时的待发队列（下轮先补发）
 *   窗口心跳-看门狗状态.json  窗口心跳自己的状态（不动企微那份，互不影响）
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const {
  bootRecoveryOnly,
  CONDITION_KEYS,
  DEFAULT_CONFIG,
  evaluate,
  formatJst,
  formatLocal,
  lastByChat,
  mergeConfig,
  parseConnectionEvents,
  parseDaemonLog,
  parseInbox,
  reconcileSessions
} = require("../src/watchdog");

const ROOT = path.join(__dirname, "..");
const DEFAULT_STATE_DIR = path.join(ROOT, ".state");
const LOG_MAX_BYTES = 1024 * 1024;

const 心跳写手 = require("./窗口心跳.cjs");
const { 判定心跳, 规整键 } = require("../src/窗口心跳判定");
const 窗口自愈 = require("../src/窗口自愈");

const EXTRA_DEFAULTS = {
  boardRepo: "c34601512-cpu/bot-board",
  boardIssue: 1,
  ghCmd: "gh",
  ghConfigDir: path.join(os.homedir(), ".config", "gh-bots"),
  ghFallbackPath: "C:\\Program Files\\GitHub CLI\\gh.exe",
  restartVerifySec: 15,
  testTag: "",
  pendingFile: "看门狗待发留言.jsonl",
  statusFile: "看门狗状态.json",
  logFile: "看门狗.log",
  lockFile: "看门狗.lock",
  // 服务端对账（2026-10-07）：静默类告警前先用 wecom-cli 会话列表对账，服务端没更新就不报（误报根治）。
  reconEnabled: true,
  wecomCliJs: path.join(process.env.APPDATA || "", "npm", "node_modules", "@wecom", "cli", "bin", "wecom.js"),
  reconMarginMin: 5,
  reconMaxAgeMin: 720,
  // 窗口心跳（2026-10-09）：独立状态文件，不动上面企微判定的任何阈值
  heartbeatRecordsFile: "窗口心跳.json",
  heartbeatStatusFile: "窗口心跳-看门狗状态.json",
  heartbeatRegistryFile: path.join(ROOT, "..", "0.木婉清档案", "runtime", "任务窗.json"),
  heartbeatReceiptDir: path.join(ROOT, "..", "0.木婉清档案", "任务回执"),
  heartbeatStaleMin: 10,
  heartbeatBootGraceMin: 30,
  heartbeatDedupeMin: 60,
  heartbeatMissingGraceMin: 10,
  heartbeatListenerName: "监听窗",
  // 窗口心跳自愈（2026-10-09 三条 + 赵敏补充两条）：先自愈、成功不发板、失败/反复才 [故障]
  heartbeatHealWaitSec: 300,        // 补写手后等 2 拍（2×150s）心跳
  heartbeatHealRetrySec: 600,       // 补写手失败后隔多久允许再补（防连发写手）
  heartbeatRecheckSec: 240,         // 监听窗死亡“复判”等待（一个巡检周期≈5 分钟，留容差）
  heartbeatReopenThrottleSec: 300,  // 两次重开至少隔一个巡检周期
  heartbeatReopenConfirmSec: 90,    // 重开后等心跳出现的确认时间
  heartbeatFlappingWindowSec: 3600, // “反复重启”统计窗
  heartbeatFlappingCount: 3,        // 1 小时内重开达到几次算崩溃循环
  heartbeatListenerMatch: ["27.企业微信机器人", "boot-prompt.md"] // 监听窗进程认窗串
};

// ---------------------------------------------------------------- 基础工具

function parseArgs(argv) {
  const args = { dryRun: false, noBoard: false, noRestart: false, noHeartbeat: false, stateDir: "", config: "", testTag: "", 心跳记录: "", 心跳任务窗: "", 心跳状态: "", 开机时刻: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-board") args.noBoard = true;
    else if (a === "--no-restart") args.noRestart = true;
    else if (a === "--no-heartbeat") args.noHeartbeat = true;
    else if (a === "--state-dir") args.stateDir = argv[++i] || "";
    else if (a === "--config") args.config = argv[++i] || "";
    else if (a === "--test-tag") args.testTag = argv[++i] || "";
    else if (a === "--心跳-记录") args.心跳记录 = argv[++i] || "";
    else if (a === "--心跳-任务窗") args.心跳任务窗 = argv[++i] || "";
    else if (a === "--心跳-状态") args.心跳状态 = argv[++i] || "";
    else if (a === "--开机时刻") args.开机时刻 = argv[++i] || "";
    else if (a === "--help" || a === "-h") {
      console.log(`企微守护看门狗（27号）—— 独立巡检长连接守护与 pi 窗口心跳，异常写机器人留言板。
用法：node scripts/企微看门狗.js [--dry-run] [--no-board] [--no-restart] [--no-heartbeat] [--state-dir <目录>] [--config <文件>] [--test-tag <文字>]
     演练窗口心跳：--心跳-记录 <文件> --心跳-任务窗 <文件> --开机时刻 <ISO>`);
      process.exit(0);
    } else {
      console.error(`未知参数：${a}（--help 看用法）`);
      process.exit(2);
    }
  }
  return args;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function readTail(file, maxBytes) {
  try {
    const st = fs.statSync(file);
    const size = Math.min(st.size, maxBytes);
    const start = Math.max(0, st.size - size);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, start);
      return buf.toString("utf8");
    } finally { fs.closeSync(fd); }
  } catch { return ""; }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isNodePid(pid) {
  const r = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (r.status !== 0 || !r.stdout) return true; // 查不了就按存活处理，宁可漏检进程名
  return /node\.exe/i.test(r.stdout);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// ---------------------------------------------------------------- 状态读取

function readDaemon(stateDir) {
  const pidPath = path.join(stateDir, "daemon.pid");
  let pid = null;
  let alive = false;
  let reason = "daemon.pid 不存在（守护从未启动或已退出）";
  try { pid = Number(fs.readFileSync(pidPath, "utf8").trim()) || null; } catch {}
  if (pid) {
    if (!processAlive(pid)) reason = `守护进程 pid ${pid} 已不在（pid 文件残留）`;
    else if (!isNodePid(pid)) reason = `pid ${pid} 被非 node 进程占用（怀疑 pid 复用）`;
    else { alive = true; reason = ""; }
  }
  const now = Date.now();
  const fromLog = parseDaemonLog(readTail(path.join(stateDir, "daemon.log"), 512 * 1024), now);
  const fromEvents = parseConnectionEvents(readTail(path.join(stateDir, "连接事件.jsonl"), 512 * 1024));
  return { daemon: { alive, pid, reason }, log: mergeConnection(fromLog, fromEvents) };
}

function mergeConnection(a, b) {
  const pa = a.lastDisconnectAt || 0;
  const pb = b.lastDisconnectAt || 0;
  const lastDisconnectAt = Math.max(pa, pb) || null;
  let disconnectReason = "";
  if (pb >= pa && b.disconnectReason) disconnectReason = b.disconnectReason;
  else disconnectReason = a.disconnectReason || b.disconnectReason || "";
  return {
    lastAuthAt: Math.max(a.lastAuthAt || 0, b.lastAuthAt || 0) || null,
    lastDisconnectAt,
    disconnectReason,
    recentWarnings: [...(a.recentWarnings || []), ...(b.recentWarnings || [])]
  };
}

function readState(stateDir, cfg) {
  const st = readJson(path.join(stateDir, cfg.statusFile)) || {};
  return { strikes: st.strikes || {}, active: st.active || {}, restarts: st.restarts || [], lastAlertAt: st.lastAlertAt || null };
}

// ---------------------------------------------------------------- 服务端对账（wecom-cli 会话列表，2026-10-07）

/** 读服务端会话列表（只读）。返回 { ok, sessions } 或 { ok:false, err }。 */
function readServerSessions(cfg) {
  const cli = String(cfg.wecomCliJs || "").trim();
  if (!cli || !fs.existsSync(cli)) return { ok: false, err: "找不到 wecom-cli（" + cli + "）" };
  const r = spawnSync(process.execPath, [cli, "message", "aibot", "sessions", "list"], {
    cwd: ROOT, encoding: "utf8", timeout: 60000, windowsHide: true
  });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const i = out.indexOf("{");
  if (r.status !== 0 || i < 0) return { ok: false, err: "wecom-cli 退出码 " + r.status + "：" + out.slice(0, 200) };
  let data;
  try { data = JSON.parse(out.slice(i)); } catch { return { ok: false, err: "会话列表不是 JSON：" + out.slice(0, 200) }; }
  if (!Array.isArray(data.sessions)) return { ok: false, err: "会话列表缺 sessions 字段" };
  return { ok: true, sessions: data.sessions };
}

function pendingCount(stateDir, cfg) {
  const p = path.join(stateDir, cfg.pendingFile);
  try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).length; } catch { return 0; }
}

// ---------------------------------------------------------------- 日志

function makeLogger(stateDir, dryRun) {
  const logPath = path.join(stateDir, "看门狗.log");
  return function log(msg) {
    const line = `[${formatLocal(Date.now())}] ${msg}`;
    console.log(line);
    if (dryRun) return;
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > LOG_MAX_BYTES) fs.renameSync(logPath, logPath + ".1");
    } catch {}
    try { fs.appendFileSync(logPath, line + "\n", "utf8"); } catch {}
  };
}

/** 自愈的本地记录写进与写手同一本 `窗口心跳.log`（何时发现、做了什么、结果）——自愈成功不发板，靠它留痕。 */
function 记心跳日志(stateDir, 文本, 不落盘 = false) {
  const 行 = `[${new Date().toISOString()}] [看门狗] ${文本}`;
  console.log(行);
  if (不落盘) return;
  try {
    const 文件 = path.join(stateDir, "窗口心跳.log");
    fs.mkdirSync(path.dirname(文件), { recursive: true });
    if (fs.existsSync(文件) && fs.statSync(文件).size > LOG_MAX_BYTES) fs.renameSync(文件, 文件 + ".1");
    fs.appendFileSync(文件, 行 + "\n", "utf8");
  } catch {}
}

// ---------------------------------------------------------------- 留言板（机器人交流频道）

function postBoard(cfg, text) {
  const env = { ...process.env, GH_CONFIG_DIR: cfg.ghConfigDir };
  const candidates = [cfg.ghCmd, cfg.ghFallbackPath].filter(Boolean);
  let lastErr = "";
  for (const gh of candidates) {
    const r = spawnSync(gh, ["issue", "comment", String(cfg.boardIssue), "--repo", cfg.boardRepo, "--body-file", "-"], {
      input: text, env, encoding: "utf8", timeout: 60000, windowsHide: true
    });
    if (r.status === 0) return { ok: true, out: String(r.stdout || "").trim() };
    lastErr = String(r.stderr || (r.error && r.error.message) || `exit ${r.status}`).trim();
    if (!(r.error && r.error.code === "ENOENT")) break; // 参数/权限错误没必要换路径重试
  }
  return { ok: false, err: lastErr };
}

function enqueue(stateDir, cfg, text) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(path.join(stateDir, cfg.pendingFile), JSON.stringify({ createdAt: new Date().toISOString(), text }) + "\n", "utf8");
  } catch {}
}

function flushQueue(stateDir, cfg, log) {
  const p = path.join(stateDir, cfg.pendingFile);
  if (!fs.existsSync(p)) return 0;
  const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
  const remain = [];
  let sent = 0;
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const r = postBoard(cfg, rec.text);
    if (r.ok) { sent++; log(`留言板补发成功（积压于 ${rec.createdAt}）`); }
    else { remain.push(line); log(`留言板补发失败：${r.err}`); }
  }
  try {
    if (remain.length) fs.writeFileSync(p, remain.join("\n") + "\n", "utf8");
    else fs.unlinkSync(p);
  } catch {}
  return sent;
}

// ---------------------------------------------------------------- 留言原文

const ALERT_DESC = {
  daemon: (d) => `守护进程不在：${d}`,
  connection: (d) => `长连接断开后未恢复：${d}`,
  both: (d) => `群聊和单聊同时静默：${d}`,
  group: (d) => `群聊疑似失联（单聊正常）：${d}`,
  single: (d) => `单聊疑似失联（群聊正常）：${d}`
};

const RESOLVE_DESC = {
  daemon: "守护进程已恢复",
  connection: "长连接已恢复认证",
  both: "群聊与单聊恢复收发",
  group: "群聊恢复收发",
  single: "单聊恢复收发"
};

const { alertTag: alertTagForKeys } = require("../src/watchdog");

function alertTag(result) {
  return alertTagForKeys((result?.toAlert || []).map((a) => a.key), result && result.recon ? result.recon.missed.length : 0);
}

function alertBody(result, cfg, restartNote) {
  const lines = [];
  lines.push(`【木婉清】${alertTag(result)}${cfg.testTag ? `（${cfg.testTag}）` : ""}`);
  lines.push(formatJst(result.nowMs));
  lines.push("");
  lines.push(`${alertTag(result) === "[故障]" ? "企微长连接守护异常" : "企微消息静默提醒"}（看门狗巡检）：`);
  for (const a of result.toAlert) {
    const desc = ALERT_DESC[a.key] ? ALERT_DESC[a.key](a.detail) : `${a.key}：${a.detail}`;
    lines.push(`- ${desc}`);
  }
  if (result.recon && result.recon.missed.length) {
    lines.push("");
    lines.push("服务端对账发现本机漏收消息（长连接可能已静默失效）：");
    for (const m of result.recon.missed.slice(0, 5)) {
      lines.push(`- ${m.chat || m.chatId}：服务端最后消息 ${formatLocal(m.serverAt)}，本机最后收到 ${formatLocal(m.localAt)}`);
    }
  }
  if (restartNote) lines.push(`- ${restartNote}`);
  else if (result.restart.suppressed) lines.push(`- 未自动重启：${result.restart.suppressed}`);
  lines.push("");
  lines.push("建议人工看一眼 27号 项目 `.state/daemon.log`；漏掉的消息企微不会补推。");
  return lines.join("\n");
}

function resolveBody(result, cfg) {
  const lines = [];
  lines.push(`【木婉清】[已解决]${cfg.testTag ? `（${cfg.testTag}）` : ""}`);
  lines.push(formatJst(result.nowMs));
  lines.push("");
  lines.push("前述企微守护告警已恢复：");
  for (const x of result.toResolve) lines.push(`- ${RESOLVE_DESC[x.key] || x.key}`);
  if (result.recon && result.recon.checked && !result.recon.missed.length) {
    lines.push("- 注：本次静默经服务端对账确认属正常（没人说话），非故障");
  }
  lines.push(`- 群聊最后消息：${formatLocal(result.messages.groupLastAt)}；单聊最后消息：${formatLocal(result.messages.singleLastAt)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- 重启

function startDaemon() {
  const vbs = path.join(__dirname, "静默启动.vbs");
  const r = spawnSync("wscript.exe", [vbs], { cwd: __dirname, windowsHide: true, timeout: 30000 });
  return r.status === 0;
}

async function verifyRestart(stateDir, cfg) {
  await sleep(cfg.restartVerifySec * 1000);
  const { daemon, log } = readDaemon(stateDir);
  const freshAuth = log.lastAuthAt != null && Date.now() - log.lastAuthAt <= 60 * 1000;
  return { ok: daemon.alive && freshAuth, pid: daemon.pid };
}

// ---------------------------------------------------------------- 并发锁

function acquireLock(stateDir, cfg) {
  const lockPath = path.join(stateDir, cfg.lockFile);
  const write = () => {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    fs.closeSync(fd);
  };
  try { write(); return true; } catch {}
  try {
    const rec = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (rec && rec.pid && processAlive(rec.pid)) return false; // 另一个看门狗还在跑
  } catch {}
  try { fs.unlinkSync(lockPath); } catch {}
  try { write(); return true; } catch { return false; }
}

function releaseLock(stateDir, cfg) {
  try { fs.unlinkSync(path.join(stateDir, cfg.lockFile)); } catch {}
}

// ---------------------------------------------------------------- 状态落盘

function buildStatus(snapshot, result, stateDir, cfg) {
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
  return {
    updatedAt: iso(result.nowMs),
    ok: result.ok,
    inWorkWindow: result.inWork,
    daemon: { alive: snapshot.daemon.alive, pid: snapshot.daemon.pid, reason: snapshot.daemon.reason },
    connection: {
      lastAuthAt: iso(result.log.lastAuthAt),
      lastDisconnectAt: iso(result.log.lastDisconnectAt),
      deaf: result.log.deaf
    },
    messages: {
      groupLastAt: iso(result.messages.groupLastAt),
      groupSilenceMin: result.silences.group,
      singleLastAt: iso(result.messages.singleLastAt),
      singleSilenceMin: result.silences.single
    },
    recon: result.recon
      ? { checked: !!result.recon.checked, missed: result.recon.missed.length, detail: result.recon.missed.slice(0, 5).map((m) => ({ chat: m.chat, serverAt: iso(m.serverAt), localAt: iso(m.localAt) })) }
      : { checked: false, missed: 0, detail: [] },
    conditions: Object.fromEntries(CONDITION_KEYS.map((k) => [k, !!result.conditions[k].hit])),
    strikes: result.nextState.strikes,
    activeAlerts: Object.keys(result.active),
    lastAlertAt: iso(result.nextState.lastAlertAt),
    restartNeeded: result.restart.needed,
    pendingBoard: pendingCount(stateDir, cfg)
  };
}

// ---------------------------------------------------------------- 窗口心跳（2026-10-09）

/** 读本次开机时刻（毫秒）；注入优先；读不到用系统运行时长兜底，再读不到返回 null。 */
function 读开机时刻(注入) {
  if (注入) {
    const t = Date.parse(注入);
    if (Number.isFinite(t)) return t;
  }
  const r = spawnSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o')"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  const t = Date.parse(String(r.stdout || "").trim());
  if (Number.isFinite(t)) return t;
  const uptimeSec = os.uptime();
  return Number.isFinite(uptimeSec) && uptimeSec > 0 ? Date.now() - uptimeSec * 1000 : null;
}

/** 读任务窗.json → 应活判定用的快照（绝对路径 + 回执是否已落）。读不到就空数组。 */
function 读心跳任务窗(文件, cfg) {
  const 原始 = readJson(文件);
  const 列表 = 原始 && Array.isArray(原始.窗口) ? 原始.窗口 : [];
  return 列表
    .map((x) => {
      const 任务 = x && x.任务 ? (path.isAbsolute(x.任务) ? x.任务 : path.resolve(path.join(ROOT, ".."), x.任务)) : "";
      const 回执 = (x && x.回执) || (任务 ? path.join(cfg.heartbeatReceiptDir, path.basename(任务)) : "");
      return { 任务, 开窗时间: (x && x.开窗时间) || null, 回执已落: !!(回执 && fs.existsSync(回执)) };
    })
    .filter((x) => x.任务);
}

/** 给心跳记录补上“任务回执已落”信息（回执落了的窗不告警，任务已收工等收窗）。 */
function 给记录配回执状态(记录映射, cfg) {
  return Object.values(记录映射 || {}).map((r) => {
    const 组 = Array.isArray(r && r.认窗) ? r.认窗 : [r && r.认窗];
    const 任务认窗 = 组.find((x) => String(x || "").startsWith("@"));
    const 任务 = 任务认窗 ? String(任务认窗).slice(1) : "";
    const 回执 = 任务 ? path.join(cfg.heartbeatReceiptDir, path.basename(任务)) : "";
    return { ...(r || {}), 已交回执: !!(回执 && fs.existsSync(回执)) };
  });
}

function 心跳告警正文(判定, nowMs, cfg) {
  const lines = [];
  lines.push(`【木婉清】[故障]${cfg.testTag ? `（${cfg.testTag}）` : ""}`);
  lines.push(formatJst(nowMs));
  lines.push("");
  lines.push("pi 窗口挂了（窗口心跳巡检；死了的窗口自己报不了自己）：");
  for (const a of 判定.toAlert) {
    lines.push(`- 窗口「${a.名}」：${a.原因}`);
    if (a.已试自愈) lines.push(`  已先自愈：${a.已试自愈}`);
    lines.push(`  证据：${a.证据}`);
  }
  lines.push("");
  lines.push("建议人工看一眼窗口，或叫监听窗重新派活/重开窗。");
  return lines.join("\n");
}

function 心跳恢复正文(判定, nowMs, cfg) {
  const lines = [];
  lines.push(`【木婉清】[已解决]${cfg.testTag ? `（${cfg.testTag}）` : ""}`);
  lines.push(formatJst(nowMs));
  lines.push("");
  lines.push("前述 pi 窗口心跳告警已恢复：");
  for (const x of 判定.toResolve) {
    lines.push(`- 窗口「${x.名}」：${x.原因 || "心跳恢复"}${x.最后心跳 ? `（最后心跳 ${x.最后心跳}${x.pid ? `，pid ${x.pid}` : ""}）` : ""}`);
  }
  return lines.join("\n");
}

/**
 * 跑一轮窗口心跳判定（含扫进程/读写文件）——只判定，不自愈；
 * 自愈动作由 main 拿着 判定.toHeal 调 窗口自愈.执行自愈 后，再 生成留言/组装状态。
 * 返回 { 判定, 状态文件, 记录文件, 登记文件, nowMs, 生成留言(), 组装状态() }。
 */
function 巡检窗口心跳({ stateDir, cfg, args, log }) {
  const nowMs = Date.now();
  const 记录文件 = args.心跳记录 ? path.resolve(args.心跳记录) : path.join(stateDir, cfg.heartbeatRecordsFile);
  const 状态文件 = args.心跳状态 ? path.resolve(args.心跳状态) : path.join(stateDir, cfg.heartbeatStatusFile);
  const 登记文件 = args.心跳任务窗 ? path.resolve(args.心跳任务窗) : cfg.heartbeatRegistryFile;
  const 记录 = 给记录配回执状态(心跳写手.读心跳(记录文件), cfg);
  const 任务窗 = 读心跳任务窗(登记文件, cfg);
  const 扫 = 心跳写手.扫pi进程();
  const 进程列表 = 扫 && 扫.ok ? 扫.列表 : null;
  if (!进程列表) log(`窗口心跳：进程扫描失败（${(扫 && 扫.错误) || "未知"}），本轮只按心跳新旧判，不判 pid`);
  const bootTimeMs = 读开机时刻(args.开机时刻);
  const 上次原始 = readJson(状态文件) || {};
  const 上次窗口 = 上次原始.窗口 || 上次原始.windows || {};
  const 上线时间Ms = 上次原始.上线At ? Date.parse(上次原始.上线At) : null;
  // 写手锁快照：补写手前看这个（绝不并发起两个写手）；记录里的窗 + 监听窗各查一把
  const 写手锁 = {};
  const 加锁 = (认窗组) => {
    const 组 = (Array.isArray(认窗组) ? 认窗组 : [认窗组]).map((x) => String(x || "")).filter(Boolean);
    if (!组.length) return;
    const 键 = 规整键(组[0]);
    if (写手锁[键]) return;
    let 活跃 = false;
    try { 活跃 = 心跳写手.单例锁活跃(心跳写手.单例锁文件(记录文件, 组[0])); } catch { 活跃 = false; }
    写手锁[键] = { 活跃 };
  };
  for (const r of 记录) 加锁(r && r.认窗);
  加锁(cfg.heartbeatListenerMatch);
  const 判定 = 判定心跳({
    nowMs,
    bootTimeMs,
    记录,
    任务窗,
    进程列表,
    写手锁,
    上线时间Ms,
    上次状态: { windows: 上次窗口 },
    config: {
      staleMin: cfg.heartbeatStaleMin,
      bootGraceMin: cfg.heartbeatBootGraceMin,
      dedupeMin: cfg.heartbeatDedupeMin,
      missingGraceMin: cfg.heartbeatMissingGraceMin,
      listenerName: cfg.heartbeatListenerName,
      listenerMatch: cfg.heartbeatListenerMatch,
      healWaitSec: cfg.heartbeatHealWaitSec,
      healRetrySec: cfg.heartbeatHealRetrySec,
      recheckSec: cfg.heartbeatRecheckSec,
      reopenThrottleSec: cfg.heartbeatReopenThrottleSec,
      reopenConfirmSec: cfg.heartbeatReopenConfirmSec,
      flappingWindowSec: cfg.heartbeatFlappingWindowSec,
      flappingCount: cfg.heartbeatFlappingCount
    }
  });
  log(`窗口心跳：目标=${判定.摘要.目标数} 正常=${判定.摘要.正常} 忽略=${判定.摘要.忽略} 告警=${判定.摘要.告警} 恢复=${判定.摘要.恢复} 自愈=${判定.摘要.自愈}`);
  const 生成留言 = () => {
    const 留言 = [];
    if (判定.toAlert.length) 留言.push(心跳告警正文(判定, nowMs, cfg));
    if (判定.toResolve.length) 留言.push(心跳恢复正文(判定, nowMs, cfg));
    return 留言;
  };
  const 组装状态 = () => ({
    ...判定.状态,
    bootTime: bootTimeMs != null ? new Date(bootTimeMs).toISOString() : null,
    摘要: { ...判定.摘要, 告警: 判定.toAlert.length, 恢复: 判定.toResolve.length, 自愈: (判定.toHeal || []).length },
    记录文件,
    登记文件
  });
  return { 判定, 状态文件, 记录文件, 登记文件, nowMs, 生成留言, 组装状态 };
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const parts = [DEFAULT_CONFIG, EXTRA_DEFAULTS, readJson(path.join(ROOT, "project-config", "watchdog.local.json"))];
  if (args.config) parts.push(readJson(args.config));
  if (args.testTag) parts.push({ testTag: args.testTag });
  const cfg = mergeConfig(...parts);
  const stateDir = args.stateDir ? path.resolve(args.stateDir) : DEFAULT_STATE_DIR;
  fs.mkdirSync(stateDir, { recursive: true });
  const log = makeLogger(stateDir, args.dryRun);

  if (!args.dryRun && !acquireLock(stateDir, cfg)) {
    console.log("已有看门狗在跑，跳过本次");
    return;
  }
  try {
    const nowMs = Date.now();
    const prev = readState(stateDir, cfg);
    const { daemon, log: connLog } = readDaemon(stateDir);
    const inboxText = readTail(path.join(stateDir, "inbox.jsonl"), 512 * 1024);
    const messages = parseInbox(inboxText);
    const snapshot = { daemon, log: connLog, messages, sys: { uptimeSec: os.uptime() } };
    let result = evaluate(snapshot, prev, cfg, nowMs);

    // 服务端对账（2026-10-07，只在静默类条件命中时查，省调用）：
    // 对账一致 ⇒ 静默属正常（没人说话）→ 静默类不报；发现漏消息 ⇒ 照报并升 [故障]。
    let recon = { checked: false, missed: [] };
    const 静默命中 = ["both", "group", "single"].some((k) => result.conditions[k].hit);
    if (cfg.reconEnabled && 静默命中) {
      const srv = readServerSessions(cfg);
      if (srv.ok) {
        recon = reconcileSessions(srv.sessions, lastByChat(inboxText), cfg, nowMs);
        result = evaluate(snapshot, prev, cfg, nowMs, recon);
        if (recon.missed.length) {
          log(`服务端对账：发现 ${recon.missed.length} 个会话本机漏收 → ` + recon.missed.map((m) => `${m.chat}（服务端 ${formatLocal(m.serverAt)}，本机 ${formatLocal(m.localAt)}）`).join("；"));
        } else {
          log(`服务端对账一致（${srv.sessions.length} 个会话），静默属正常（没人说话），不告警`);
        }
      } else {
        log(`服务端对账不可用（${srv.err}），按原静默口径处理`);
      }
    }
    result.recon = recon;
    let restartNote = "";
    let restartVerified = false;

    if (result.restart.needed && !args.dryRun) {
      if (args.noRestart) {
        restartNote = `[演练] 跳过自动重启（本应执行：${result.restart.reason}）`;
        log(restartNote);
      } else if (!result.restart.allowed) {
        restartNote = `未自动重启：${result.restart.suppressed}`;
        log(restartNote);
      } else {
        log(`重启守护（原因：${result.restart.reason}）`);
        const started = startDaemon();
        const v = started ? await verifyRestart(stateDir, cfg) : { ok: false, pid: null };
        if (v.ok) restartVerified = true;
        restartNote = v.ok
          ? `已自动重启守护并确认恢复（pid ${v.pid}）`
          : `已尝试自动重启，${cfg.restartVerifySec} 秒内仍未见到认证成功`;
        log(`重启结果：${restartNote}`);
        result.nextState.restarts = [...(prev.restarts || []), new Date(nowMs).toISOString()];
      }
    } else if (result.restart.needed && args.dryRun) {
      restartNote = `[dry-run] 本应重启：${result.restart.reason}`;
    }

    log(`巡检 ok=${result.ok} 守护=${daemon.alive ? "在" : "不在"} 群静默=${result.silences.group}min 单聊静默=${result.silences.single}min 告警=${result.toAlert.map((a) => a.key).join(",") || "无"} 恢复=${result.toResolve.map((x) => x.key).join(",") || "无"}`);

    // 开机恢复降噪（2026-10-08）：开机窗口内守护缺席=随关机停止，非故障；已自动拉起就不占板面。
    if (!args.dryRun && bootRecoveryOnly(result.toAlert, restartVerified)) {
      log(`开机恢复：守护缺席发生在开机 ${Math.round(os.uptime() / 60)} 分钟内，已自动拉起（按开机降噪，不占板面）`);
      delete result.nextState.active.daemon; // 防下一轮补发 [已解决]
      result.toAlert = [];
    }

    if (!args.dryRun && !args.noBoard) {
      flushQueue(stateDir, cfg, log);
      if (result.toAlert.length) {
        const text = alertBody(result, cfg, restartNote);
        const r = postBoard(cfg, text);
        if (r.ok) log(`留言板已写${alertTag(result)}：${r.out}`);
        else { enqueue(stateDir, cfg, text); log(`留言板写入失败：${r.err}（已存待发队列）`); }
      } else if (result.toResolve.length) {
        const text = resolveBody(result, cfg);
        const r = postBoard(cfg, text);
        if (r.ok) log(`留言板已写[已解决]：${r.out}`);
        else { enqueue(stateDir, cfg, text); log(`留言板写入失败：${r.err}（已存待发队列）`); }
      }
    } else if (result.toAlert.length || result.toResolve.length) {
      const text = result.toAlert.length ? alertBody(result, cfg, restartNote) : resolveBody(result, cfg);
      log(`[dry-run/未发板] 本应写留言板：\n${text}`);
    }

    // ---- 窗口心跳巡检（2026-10-09；独立判定、独立状态，不动上面企微逻辑）----
    // 自愈三条（2026-10-09）：先自愈——补写手/重开监听窗；成功只记本地日志不发板，失败/反复才 [故障]。
    if (!args.noHeartbeat) {
      try {
        const hb = 巡检窗口心跳({ stateDir, cfg, args, log });
        const 心跳cfg = {
          dedupeMin: cfg.heartbeatDedupeMin,
          healWaitSec: cfg.heartbeatHealWaitSec,
          healRetrySec: cfg.heartbeatHealRetrySec,
          recheckSec: cfg.heartbeatRecheckSec,
          reopenThrottleSec: cfg.heartbeatReopenThrottleSec,
          reopenConfirmSec: cfg.heartbeatReopenConfirmSec,
          flappingWindowSec: cfg.heartbeatFlappingWindowSec,
          flappingCount: cfg.heartbeatFlappingCount,
          listenerMatch: cfg.heartbeatListenerMatch
        };
        // --no-restart 也算演练：只标记不做（避免假状态演练真去动生产窗口）
        const 自愈演练 = args.dryRun || args.noRestart;
        await 窗口自愈.执行自愈(hb.判定, {
          记录文件: hb.记录文件,
          cfg: 心跳cfg,
          dryRun: 自愈演练,
          log,
          记本地日志: (文本) => 记心跳日志(stateDir, 文本, args.dryRun),
          保存状态: args.dryRun ? null : () => fs.writeFileSync(hb.状态文件, JSON.stringify(hb.组装状态(), null, 2), "utf8")
        });
        if (自愈演练) log(`[演练] 窗口心跳自愈本轮只标记不做（--dry-run/--no-restart）`);
        else if ((hb.判定.toHeal || []).length) log(`窗口心跳自愈：本轮动作 ${hb.判定.toHeal.map((x) => `${x.动作}(${x.名})`).join("、")}`);
        for (const x of hb.判定.自愈结果 || []) {
          记心跳日志(stateDir, `自愈结果：${x.结果}——${x.名} ${x.动作}：${x.说明}`);
        }
        const 留言 = hb.生成留言();
        if (!args.dryRun && !args.noBoard) {
          for (const text of 留言) {
            const r = postBoard(cfg, text);
            if (r.ok) log(`留言板已写窗口心跳：${r.out}`);
            else { enqueue(stateDir, cfg, text); log(`窗口心跳写板失败：${r.err}（已存待发队列）`); }
          }
        } else if (留言.length) {
          log(`[dry-run/未发板] 本应写留言板（窗口心跳）：\n${留言.join("\n---\n")}`);
        }
        if (!args.dryRun) fs.writeFileSync(hb.状态文件, JSON.stringify(hb.组装状态(), null, 2), "utf8");
      } catch (e) {
        log(`窗口心跳巡检异常（不影响企微判定）：${(e && e.stack) || e}`);
      }
    }

    if (!args.dryRun) {
      const status = buildStatus(snapshot, result, stateDir, cfg);
      status.strikes = result.nextState.strikes;
      status.active = result.nextState.active;
      status.restarts = result.nextState.restarts;
      status.lastAlertAt = result.nextState.lastAlertAt ? new Date(result.nextState.lastAlertAt).toISOString() : null;
      status.pendingBoard = pendingCount(stateDir, cfg);
      fs.writeFileSync(path.join(stateDir, cfg.statusFile), JSON.stringify(status, null, 2), "utf8");
    }
  } finally {
    if (!args.dryRun) releaseLock(stateDir, cfg);
  }
}

main().catch((err) => {
  const stateDir = parseArgs(process.argv.slice(2)).stateDir || DEFAULT_STATE_DIR;
  try { fs.mkdirSync(stateDir, { recursive: true }); } catch {}
  try { fs.appendFileSync(path.join(stateDir, "看门狗.log"), `[${formatLocal(Date.now())}] 看门狗异常：${err && err.stack ? err.stack : err}\n`, "utf8"); } catch {}
  console.error("看门狗异常：" + (err && err.message ? err.message : err));
  process.exitCode = 1;
});

module.exports = { alertTag };
