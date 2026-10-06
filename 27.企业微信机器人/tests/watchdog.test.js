"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_CONFIG,
  mergeConfig,
  silenceMinutes,
  parseDaemonLog,
  parseConnectionEvents,
  parseInbox,
  evaluate,
  formatJst
} = require("../src/watchdog");

const cfg = DEFAULT_CONFIG;
const NOON = new Date(2026, 9, 6, 12, 0, 0).getTime(); // 2026-10-06 12:00 本地
const MIN = 60 * 1000;

function emptyState() {
  return { strikes: {}, active: {}, restarts: [] };
}

function snapshot(opts = {}) {
  return {
    daemon: { alive: opts.alive !== false, pid: opts.alive === false ? null : 1234, reason: opts.reason || "守护进程不在" },
    log: {
      lastAuthAt: "lastAuthAt" in opts ? opts.lastAuthAt : NOON - 2 * MIN,
      lastDisconnectAt: opts.lastDisconnectAt || null,
      disconnectReason: opts.disconnectReason || "",
      recentWarnings: opts.warnings || []
    },
    messages: {
      group: { count: opts.groupLastAt ? 1 : 0, lastAt: opts.groupLastAt || null },
      single: { count: opts.singleLastAt ? 1 : 0, lastAt: opts.singleLastAt || null }
    }
  };
}

test("群静默但单聊正常：连续 2 次后报警（单聊不掩蔽群）", () => {
  const snap = snapshot({ groupLastAt: NOON - 200 * MIN, singleLastAt: NOON - 5 * MIN });
  const first = evaluate(snap, emptyState(), cfg, NOON);
  assert.equal(first.strikes.group, 1);
  assert.equal(first.toAlert.length, 0, "第 1 次只累计，不报警");
  const second = evaluate(snap, first.nextState, cfg, NOON + 5 * MIN);
  assert.ok(second.toAlert.some((a) => a.key === "group"), "第 2 次应报群聊");
  assert.equal(second.conditions.single.hit, false, "单聊正常不应被报");
});

test("单聊静默但群正常：连续 2 次后报警", () => {
  const snap = snapshot({ groupLastAt: NOON - 5 * MIN, singleLastAt: NOON - 150 * MIN });
  const first = evaluate(snap, emptyState(), cfg, NOON);
  assert.equal(first.toAlert.length, 0);
  const second = evaluate(snap, first.nextState, cfg, NOON + 5 * MIN);
  assert.ok(second.toAlert.some((a) => a.key === "single"), "第 2 次应报单聊");
  assert.equal(second.conditions.group.hit, false, "群聊正常不应被报");
});

test("群和单聊都正常：不报警", () => {
  const snap = snapshot({ groupLastAt: NOON - 5 * MIN, singleLastAt: NOON - 3 * MIN });
  const r = evaluate(snap, emptyState(), cfg, NOON);
  assert.equal(r.ok, true);
  assert.equal(r.toAlert.length, 0);
  assert.equal(r.toResolve.length, 0);
});

test("群聊与单聊同时静默超过阈值：both 条件兜底报警", () => {
  const snap = snapshot({ groupLastAt: NOON - 150 * MIN, singleLastAt: NOON - 130 * MIN });
  const first = evaluate(snap, emptyState(), cfg, NOON);
  assert.equal(first.toAlert.length, 0);
  assert.equal(first.strikes.both, 1);
  const second = evaluate(snap, first.nextState, cfg, NOON + 5 * MIN);
  assert.ok(second.toAlert.some((a) => a.key === "both"), "两个通道都静默应报 both");
});

test("工作时段外（23:00）不报消息静默", () => {
  const night = new Date(2026, 9, 6, 23, 0, 0).getTime();
  const snap = snapshot({ groupLastAt: night - 300 * MIN, singleLastAt: night - 300 * MIN });
  const r = evaluate(snap, emptyState(), cfg, night);
  assert.equal(r.inWork, false);
  assert.equal(r.conditions.group.hit, false);
  assert.equal(r.conditions.single.hit, false);
  assert.equal(r.conditions.both.hit, false);
  assert.equal(r.ok, true);
});

test("晚上防误报：群静默 200 分钟 + 单聊也 100 分钟没消息（都未到 both 阈值）→ 不报", () => {
  const snap = snapshot({ groupLastAt: NOON - 200 * MIN, singleLastAt: NOON - 100 * MIN });
  const r = evaluate(snap, emptyState(), cfg, NOON);
  assert.equal(r.toAlert.length, 0, "单聊不活跃时群静默不单独报；单聊又没到 120 分钟，both 也不成立");
});

test("消息静默（群静默+单聊活跃）达阈值：报警但**不重启**守护（2026-10-06 误报收严）", () => {
  const snap = snapshot({ groupLastAt: NOON - 200 * MIN, singleLastAt: NOON - 5 * MIN });
  const state = { strikes: { group: 1 }, active: {}, restarts: [] };
  const r = evaluate(snap, state, cfg, NOON);
  assert.ok(r.toAlert.some((a) => a.key === "group"), "群静默应报警");
  assert.equal(r.restart.needed, false, "消息静默类不许自动重启守护（只报警）");
});

test("守护进程不在：1 次即报警，且需要重启", () => {
  const snap = snapshot({ alive: false, reason: "pid 文件不存在（守护从未启动或已退出）" });
  const r = evaluate(snap, emptyState(), cfg, NOON);
  assert.ok(r.toAlert.some((a) => a.key === "daemon"));
  assert.equal(r.restart.needed, true);
  assert.equal(r.restart.allowed, true);
});

test("断线后未恢复认证：1 次即报警（确定性失聪）", () => {
  const snap = snapshot({
    lastAuthAt: NOON - 3 * 60 * MIN,
    lastDisconnectAt: NOON - 2 * 60 * MIN,
    disconnectReason: "Received disconnected_event: a new connection has been established"
  });
  const r = evaluate(snap, emptyState(), cfg, NOON);
  assert.equal(r.log.deaf, true);
  assert.ok(r.toAlert.some((a) => a.key === "connection"));
  assert.equal(r.restart.needed, true);
});

test("重启节流：10 分钟内刚重启过 → 抑制重启", () => {
  const snap = snapshot({ alive: false });
  const state = { strikes: {}, active: {}, restarts: [new Date(NOON - 5 * MIN).toISOString()] };
  const r = evaluate(snap, state, cfg, NOON);
  assert.equal(r.restart.needed, true);
  assert.equal(r.restart.allowed, false);
  assert.match(r.restart.suppressed, /不足 10 分钟/);
});

test("恢复后：把 active 告警收掉，产出 [已解决] 信号", () => {
  const bad = snapshot({ groupLastAt: NOON - 200 * MIN, singleLastAt: NOON - 5 * MIN });
  let r = evaluate(bad, emptyState(), cfg, NOON);
  r = evaluate(bad, r.nextState, cfg, NOON + 5 * MIN);
  assert.ok(r.active.group, "先进入告警中状态");

  const now2 = NOON + 10 * MIN;
  const good = snapshot({ groupLastAt: now2 - 1 * MIN, singleLastAt: now2 - 2 * MIN });
  const r2 = evaluate(good, r.nextState, cfg, now2);
  assert.ok(r2.toResolve.some((x) => x.key === "group"));
  assert.equal(r2.active.group, undefined);
  assert.equal(r2.ok, true);
});

test("silenceMinutes：静默从今天 9:00 起算（不把昨天夜里的空白算进来）", () => {
  const now = new Date(2026, 9, 6, 10, 0, 0).getTime();
  const yesterdayEvening = new Date(2026, 9, 5, 21, 0, 0).getTime();
  assert.equal(silenceMinutes(yesterdayEvening, now, cfg), 60, "昨天 21:00 → 今天 10:00 只算 9:00–10:00");
  assert.equal(silenceMinutes(null, now, cfg), 60, "从没收到过 → 也从 9:00 起算");
  assert.equal(silenceMinutes(new Date(2026, 9, 6, 8, 30, 0).getTime(), now, cfg), 60, "在窗口前收到的消息也算从 9:00 起");
  assert.equal(silenceMinutes(new Date(2026, 9, 6, 9, 30, 0).getTime(), now, cfg), 30);
});

test("parseDaemonLog：取出最后认证 / 最后断开 / 30 分钟内 WARN", () => {
  const now = new Date(2026, 9, 6, 12, 0, 0).getTime();
  const text = [
    "[2026-10-06T02:00:00.000Z] [AiBotSDK] [ERROR] WebSocket error: read ECONNRESET",
    "[2026-10-06T03:00:00.000Z] [AiBotSDK] [INFO] Authentication successful",
    "[11:30:00] 长连接认证并订阅成功（只收不回）",
    "[2026-10-06T03:50:00.000Z] [AiBotSDK] [WARN] Received disconnected_event: a new connection has been established"
  ].join("\n");
  const r = parseDaemonLog(text, now);
  assert.equal(r.lastAuthAt, Date.parse("2026-10-06T03:30:00.000Z"));
  assert.equal(r.lastDisconnectAt, Date.parse("2026-10-06T03:50:00.000Z"));
  assert.match(r.disconnectReason, /disconnected_event/);
  assert.equal(r.recentWarnings.length, 1, "2 小时前的 ERROR 不算近期 WARN");
});

test("parseInbox：群 / 单聊分开取最后一条", () => {
  const text = [
    JSON.stringify({ at: "2026-10-06T03:00:00.000Z", chattype: "group", msgid: "1" }),
    JSON.stringify({ at: "2026-10-06T03:05:00.000Z", chattype: "single", msgid: "2" }),
    JSON.stringify({ at: "2026-10-06T03:10:00.000Z", chattype: "single", msgid: "3" }),
    "半行截断的垃圾"
  ].join("\n");
  const r = parseInbox(text);
  assert.equal(r.group.count, 1);
  assert.equal(r.single.count, 2);
  assert.equal(r.group.lastAt, Date.parse("2026-10-06T03:00:00.000Z"));
  assert.equal(r.single.lastAt, Date.parse("2026-10-06T03:10:00.000Z"));
});

test("parseConnectionEvents：探针文件的认证/断开事件", () => {
  const text = [
    JSON.stringify({ at: "2026-10-06T03:00:00.000Z", event: "authenticated" }),
    JSON.stringify({ at: "2026-10-06T03:30:00.000Z", event: "disconnected", detail: "Server disconnected this connection" })
  ].join("\n");
  const r = parseConnectionEvents(text);
  assert.equal(r.lastAuthAt, Date.parse("2026-10-06T03:00:00.000Z"));
  assert.equal(r.lastDisconnectAt, Date.parse("2026-10-06T03:30:00.000Z"));
  assert.match(r.disconnectReason, /Server disconnected/);
});

test("formatJst：UTC+9 的日本时间", () => {
  assert.equal(formatJst(Date.parse("2026-10-06T08:14:00Z")), "2026-10-06 17:14（日本时间）");
});

test("mergeConfig：覆盖字段、忽略非法值", () => {
  const c = mergeConfig({ groupSilentMin: 240 }, { groupSilentMin: "bad", recentMin: 30 });
  assert.equal(c.groupSilentMin, 240, "非数字不接受");
  assert.equal(c.recentMin, 30);
  assert.equal(c.singleSilentMin, DEFAULT_CONFIG.singleSilentMin);
});
