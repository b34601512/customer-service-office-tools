"use strict";

/**
 * 企微守护看门狗 —— 纯判定逻辑（无 IO、无副作用，便于单测）。
 *
 * 背景（2026-10-06 漏消息研究，回执见 0.木婉清档案/任务回执/2026-10-06-漏消息根治研究.md）：
 * - 官方：每个机器人同一时间只能有一条长连接，被新连接顶掉时旧连接才收 disconnected_event；
 * - 本机 SDK 1.0.7 被顶后不会自动重连（进程活着但永久失聪）；
 * - 长连接没有补推/补拉 → 漏掉的消息企微侧找不回来，只能靠独立巡检尽早发现；
 * - 社区教训（hermes #58649）：单聊一直有消息会把看门狗"喂饱"，群通道悄悄死了发现不了
 *   → 群 / 单聊必须分开计时。
 *
 * 判定口径（保守，避免误报）：
 * - 只在本机工作时段（默认 9:00–22:00）内对"消息静默"计时；静默从"今天 9:00"起算，
 *   不把昨天夜里的空白算进来（免得早上刚开机就误报）。
 * - 群聊只有被 @ 才有消息：所以"群静默"要配合"单聊最近有消息"才单独报（晚上没人说话属正常）；
 *   反过来"单聊静默"要求"群聊最近有消息"；两边都静默超阈值则由 both 条件兜底。
 * - 消息类条件连续 N 次（默认 2 次；看门狗 5 分钟一跑 ≈ 10 分钟）命中才报；
 *   "守护进程不在 / 断线未恢复"是确定性故障，1 次即报。
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const CONDITION_KEYS = ["daemon", "connection", "both", "group", "single"];

const DEFAULT_CONFIG = Object.freeze({
  // 工作时间（本地分钟数）：只有这段时间内才累计"消息静默"
  workStartMin: 9 * 60,
  workEndMin: 22 * 60,
  // 静默阈值（分钟）
  groupSilentMin: 180,   // 群聊：只有被 @ 才有消息，阈值放宽
  singleSilentMin: 120,  // 单聊：消息密，2 小时异常
  bothSilentMin: 120,    // 两个通道都静默：强信号（连接大概率死了）
  recentMin: 60,         // "最近有消息"的窗口
  // 连续命中次数才报警
  daemonStrikes: 1,
  connectionStrikes: 1,
  bothStrikes: 2,
  groupStrikes: 2,
  singleStrikes: 2,
  // 告警/重启节流
  alertCooldownMin: 60,
  restartCooldownMin: 10,
  restartMaxPerHour: 3
});

function mergeConfig(...parts) {
  const out = { ...DEFAULT_CONFIG };
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined || v === null) continue;
      const current = out[k];
      if (typeof current === "number") {
        if (typeof v !== "number" || !Number.isFinite(v)) continue; // 数值键只接受有限数字
      }
      out[k] = v;
    }
  }
  return out;
}

function startOfLocalDayMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 某天的工作时段 [起, 止) 毫秒。 */
function workBounds(dateMs, cfg) {
  const base = startOfLocalDayMs(dateMs);
  return [base + cfg.workStartMin * MINUTE, base + cfg.workEndMin * MINUTE];
}

function inWorkWindow(nowMs, cfg) {
  const [s, e] = workBounds(nowMs, cfg);
  return nowMs >= s && nowMs < e;
}

/** [from, to) 与"每天工作时段"的交集，单位分钟。 */
function workWindowOverlapMin(fromMs, toMs, cfg) {
  if (!(fromMs < toMs)) return 0;
  let cur = startOfLocalDayMs(fromMs);
  let total = 0;
  let guard = 0;
  while (cur < toMs && guard++ < 40) {
    const [s, e] = workBounds(cur, cfg);
    const a = Math.max(fromMs, s);
    const b = Math.min(toMs, e);
    if (b > a) total += (b - a) / MINUTE;
    cur += 24 * HOUR;
  }
  return total;
}

/**
 * 某通道已静默多少分钟（只算工作时段；从"今天 9:00 或最后一条消息（取晚者）"起算）。
 * 返回 0 表示还没开始累计 / 不在计时范围。
 */
function silenceMinutes(lastAtMs, nowMs, cfg) {
  const [todayStart] = workBounds(nowMs, cfg);
  const start = lastAtMs == null ? todayStart : Math.max(Number(lastAtMs) || 0, todayStart);
  if (!(start < nowMs)) return 0;
  return Math.round(workWindowOverlapMin(start, nowMs, cfg));
}

/** 解析日志行首的时间戳：ISO 原样解析；`HH:MM:SS` 按"今天（本地）"补日期，跨天自动回退。 */
function parseLogTime(raw, nowMs) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(nowMs);
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3]), 0);
  let t = d.getTime();
  if (t > nowMs + MINUTE) t -= 24 * HOUR; // 日志跨了午夜
  return t;
}

const AUTH_RE = /认证并订阅成功|Authentication successful/;
const BAD_RE = /连接断开|disconnected_event|No heartbeat ack|WebSocket error|reconnect attempts reached|Authentication failed|认证失败|Auth failed/i;
const BAD_WARN_RE = /disconnected_event|No heartbeat ack|reconnect attempts reached|Authentication failed|认证失败|Max auth failure/i;
const WARN_LINE_RE = /\[(WARN|ERROR)\]/;

/**
 * 解析 `daemon.log`（尾部若干 KB）：最后认证时间 / 最后断开时间 / 断开原文 / 近期 WARN&ERROR 行。
 * 注意：这是一次"只读最近现场"，全文不需要。
 */
function parseDaemonLog(text, nowMs, options = {}) {
  const warnWindowMin = Number(options.warnWindowMin) > 0 ? Number(options.warnWindowMin) : 30;
  const out = { lastAuthAt: null, lastDisconnectAt: null, disconnectReason: "", recentWarnings: [] };
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^\[([^\]]+)\]/);
    const ts = m ? parseLogTime(m[1], nowMs) : null;
    if (AUTH_RE.test(line) && ts != null) {
      out.lastAuthAt = Math.max(out.lastAuthAt || 0, ts);
    }
    if (BAD_RE.test(line)) {
      if (ts != null && ts >= (out.lastDisconnectAt || 0)) {
        out.lastDisconnectAt = ts;
        out.disconnectReason = line.trim().slice(0, 200);
      }
      if (WARN_LINE_RE.test(line) && ts != null && nowMs - ts >= 0 && nowMs - ts <= warnWindowMin * MINUTE) {
        out.recentWarnings.push(line.trim().slice(0, 200));
      }
    }
  }
  return out;
}

/** 解析 `连接事件.jsonl`（守护进程探针写的连接级事件，可选存在）。 */
function parseConnectionEvents(text) {
  const out = { lastAuthAt: null, lastDisconnectAt: null, disconnectReason: "", recentWarnings: [] };
  for (const line of String(text || "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    const t = Date.parse(rec && rec.at);
    if (Number.isNaN(t)) continue;
    if (rec.event === "authenticated") out.lastAuthAt = Math.max(out.lastAuthAt || 0, t);
    if (rec.event === "disconnected" || rec.event === "kicked") {
      if (t >= (out.lastDisconnectAt || 0)) {
        out.lastDisconnectAt = t;
        out.disconnectReason = String(rec.detail || rec.reason || "").slice(0, 200);
      }
    }
    if (rec.event === "error") out.recentWarnings.push(String(rec.detail || rec.message || "").slice(0, 200));
  }
  return out;
}

/** 解析 `inbox.jsonl`（尾部若干 KB）：群 / 单聊各取"最后一条消息时间 + 条数"。 */
function parseInbox(text) {
  const out = { group: { count: 0, lastAt: null }, single: { count: 0, lastAt: null } };
  for (const line of String(text || "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; } // 尾部截断的半行直接忽略
    const t = Date.parse(rec.at || rec.receivedAt || "");
    if (Number.isNaN(t)) continue;
    const bucket = rec.chattype === "group" ? out.group : out.single;
    bucket.count++;
    if (bucket.lastAt == null || t > bucket.lastAt) bucket.lastAt = t;
  }
  return out;
}

function normMs(v) {
  if (v == null) return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * 核心判定。输入：
 *  - snapshot: { daemon:{alive,pid,reason}, log:{lastAuthAt,lastDisconnectAt,disconnectReason,recentWarnings}, messages:{group:{lastAt,count},single:{lastAt,count}} }
 *  - state:    { strikes:{}, active:{}, restarts:[] }（上次落盘）
 *  - cfg / nowMs
 * 输出：条件判定、命中次数、要发的告警/恢复、是否要重启守护，以及 nextState（不含重启时间，由调用方补）。
 */
function evaluate(snapshot, state, cfg, nowMs) {
  const msgs = (snapshot && snapshot.messages) || {};
  const log = (snapshot && snapshot.log) || {};
  const daemon = (snapshot && snapshot.daemon) || { alive: false, reason: "快照缺失" };
  const prevStrikes = (state && state.strikes) || {};
  const prevActive = (state && state.active) || {};

  const inWork = inWorkWindow(nowMs, cfg);
  const groupLast = msgs.group ? msgs.group.lastAt : null;
  const singleLast = msgs.single ? msgs.single.lastAt : null;
  const groupSil = silenceMinutes(groupLast, nowMs, cfg);
  const singleSil = silenceMinutes(singleLast, nowMs, cfg);
  const groupRecent = groupLast != null && nowMs - groupLast <= cfg.recentMin * MINUTE;
  const singleRecent = singleLast != null && nowMs - singleLast <= cfg.recentMin * MINUTE;

  // 断线未恢复：最后一次断开之后没有再认证成功（确定性失聪）
  const deaf = !!(log.lastDisconnectAt && (!log.lastAuthAt || log.lastAuthAt < log.lastDisconnectAt));
  const badWarn = (log.recentWarnings || []).find((w) => BAD_WARN_RE.test(w)) || "";
  const connectionHit = !!daemon.alive && (deaf || !!badWarn);

  const minutesAgo = (t) => (t == null ? "很久没有" : `${Math.max(0, Math.round((nowMs - t) / MINUTE))} 分钟前`);
  const conditions = {
    daemon: {
      hit: !daemon.alive,
      detail: daemon.reason || "守护进程不在"
    },
    connection: {
      hit: connectionHit,
      detail: deaf ? (log.disconnectReason || "连接断开后未恢复认证") : (badWarn || "连接异常")
    },
    both: {
      hit: !!daemon.alive && inWork && groupSil >= cfg.bothSilentMin && singleSil >= cfg.bothSilentMin,
      detail: `群聊静默 ${groupSil} 分钟、单聊静默 ${singleSil} 分钟（各自阈值 ${cfg.bothSilentMin}）`
    },
    group: {
      hit: !!daemon.alive && inWork && groupSil >= cfg.groupSilentMin && singleRecent,
      detail: `群聊静默 ${groupSil} 分钟（阈值 ${cfg.groupSilentMin}；单聊 ${minutesAgo(singleLast)}有消息）`
    },
    single: {
      hit: !!daemon.alive && inWork && singleSil >= cfg.singleSilentMin && groupRecent,
      detail: `单聊静默 ${singleSil} 分钟（阈值 ${cfg.singleSilentMin}；群聊 ${minutesAgo(groupLast)}有消息）`
    }
  };

  const minStrikes = {
    daemon: cfg.daemonStrikes,
    connection: cfg.connectionStrikes,
    both: cfg.bothStrikes,
    group: cfg.groupStrikes,
    single: cfg.singleStrikes
  };

  const strikes = {};
  const active = JSON.parse(JSON.stringify(prevActive));
  const toAlert = [];
  const toResolve = [];
  for (const key of CONDITION_KEYS) {
    const hit = !!(conditions[key] && conditions[key].hit);
    strikes[key] = hit ? (Number(prevStrikes[key]) || 0) + 1 : 0;
    const act = active[key];
    if (hit && strikes[key] >= minStrikes[key]) {
      const due = !act || !(act.lastAt) || nowMs - act.lastAt >= cfg.alertCooldownMin * MINUTE;
      if (due) {
        toAlert.push({ key, detail: conditions[key].detail, strikes: strikes[key] });
        active[key] = { since: act && act.since ? act.since : nowMs, lastAt: nowMs };
      }
    } else if (!hit && act) {
      toResolve.push({ key, since: act.since || null });
      delete active[key];
    }
  }

  // 重启判定：**只对确定性故障**（守护进程不在 / 长连接断开后未恢复）自动重启。
  // 消息静默类（group/single/both）**只报警、不重启**：2026-10-06 19:00 误报实例——夜里金牌组本来没人说话，
  // 群静默 180min+ 就把正常守护（pid 未变）"重启"了一次（幸好未生效）；避免误报去动生产守护。
  const restartWanted =
    conditions.daemon.hit ||
    conditions.connection.hit;
  const restart = { needed: restartWanted, allowed: false, reason: "", suppressed: "" };
  if (restartWanted) {
    restart.reason = conditions.daemon.hit ? "守护进程不在"
      : "长连接断开后未恢复";
    const hourAgo = nowMs - HOUR;
    const recent = (state && state.restarts ? state.restarts : [])
      .map(normMs)
      .filter((t) => t != null && t > hourAgo);
    const last = recent.length ? Math.max(...recent) : null;
    if (recent.length >= cfg.restartMaxPerHour) {
      restart.suppressed = `最近 1 小时已重启 ${recent.length} 次（上限 ${cfg.restartMaxPerHour}）`;
    } else if (last != null && nowMs - last < cfg.restartCooldownMin * MINUTE) {
      restart.suppressed = `距上次重启不足 ${cfg.restartCooldownMin} 分钟`;
    } else {
      restart.allowed = true;
    }
  }

  const ok = CONDITION_KEYS.every((k) => !conditions[k].hit);
  const lastAlertAt = toAlert.length
    ? nowMs
    : ((state && state.lastAlertAt) || null);

  return {
    nowMs,
    inWork,
    ok,
    silences: { group: groupSil, single: singleSil },
    recent: { group: groupRecent, single: singleRecent },
    messages: { groupLastAt: groupLast, singleLastAt: singleLast },
    log: {
      lastAuthAt: log.lastAuthAt || null,
      lastDisconnectAt: log.lastDisconnectAt || null,
      disconnectReason: log.disconnectReason || "",
      deaf,
      badWarn
    },
    conditions,
    strikes,
    active,
    toAlert,
    toResolve,
    restart,
    nextState: {
      strikes,
      active,
      restarts: (state && state.restarts) || [],
      lastAlertAt,
      lastRunAt: nowMs
    }
  };
}

/** 日本时间（UTC+9）字符串：留言板规矩用。 */
function formatJst(ms) {
  const d = new Date(ms + 9 * HOUR);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}（日本时间）`;
}

/** 本地时间字符串（日志/留言用）。 */
function formatLocal(ms) {
  if (ms == null) return "（无记录）";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = {
  DEFAULT_CONFIG,
  CONDITION_KEYS,
  mergeConfig,
  startOfLocalDayMs,
  workBounds,
  inWorkWindow,
  workWindowOverlapMin,
  silenceMinutes,
  parseLogTime,
  parseDaemonLog,
  parseConnectionEvents,
  parseInbox,
  evaluate,
  formatJst,
  formatLocal
};
