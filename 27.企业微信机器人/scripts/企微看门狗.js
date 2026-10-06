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
 *
 * 产物（默认都在 27号/.state/；`.state` 已 gitignore）：
 *   看门狗.log          本轮巡检记录（>1MB 轮转 .1）
 *   看门狗状态.json     最近状态 + 连续命中次数 + 告警状态（监听窗可定时读）
 *   看门狗待发留言.jsonl 留言板写失败时的待发队列（下轮先补发）
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const {
  CONDITION_KEYS,
  DEFAULT_CONFIG,
  evaluate,
  formatJst,
  formatLocal,
  mergeConfig,
  parseConnectionEvents,
  parseDaemonLog,
  parseInbox
} = require("../src/watchdog");

const ROOT = path.join(__dirname, "..");
const DEFAULT_STATE_DIR = path.join(ROOT, ".state");
const LOG_MAX_BYTES = 1024 * 1024;

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
  lockFile: "看门狗.lock"
};

// ---------------------------------------------------------------- 基础工具

function parseArgs(argv) {
  const args = { dryRun: false, noBoard: false, noRestart: false, stateDir: "", config: "", testTag: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-board") args.noBoard = true;
    else if (a === "--no-restart") args.noRestart = true;
    else if (a === "--state-dir") args.stateDir = argv[++i] || "";
    else if (a === "--config") args.config = argv[++i] || "";
    else if (a === "--test-tag") args.testTag = argv[++i] || "";
    else if (a === "--help" || a === "-h") {
      console.log(`企微守护看门狗（27号）—— 独立巡检长连接守护，异常写机器人留言板。
用法：node scripts/企微看门狗.js [--dry-run] [--no-board] [--no-restart] [--state-dir <目录>] [--config <文件>] [--test-tag <文字>]`);
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
  return alertTagForKeys((result?.toAlert || []).map((a) => a.key));
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
    conditions: Object.fromEntries(CONDITION_KEYS.map((k) => [k, !!result.conditions[k].hit])),
    strikes: result.nextState.strikes,
    activeAlerts: Object.keys(result.active),
    lastAlertAt: iso(result.nextState.lastAlertAt),
    restartNeeded: result.restart.needed,
    pendingBoard: pendingCount(stateDir, cfg)
  };
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
    const messages = parseInbox(readTail(path.join(stateDir, "inbox.jsonl"), 512 * 1024));
    const snapshot = { daemon, log: connLog, messages };
    const result = evaluate(snapshot, prev, cfg, nowMs);
    let restartNote = "";

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
