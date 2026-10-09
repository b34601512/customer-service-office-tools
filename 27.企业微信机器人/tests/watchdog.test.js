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
  bootRecoveryOnly,
  formatJst,
  pickBoardIssue
} = require("../src/watchdog");

const cfg = DEFAULT_CONFIG;
// 群静默默认阈值 2026-10-06 放宽到 720min；这几条测试关心的是「达阈值后的行为」，用紧凑阈值跑，不受默认值调整影响。
const cfgTight = mergeConfig(DEFAULT_CONFIG, { groupSilentMin: 120 });
const NOON = new Date(2026, 9, 6, 12, 0, 0).getTime(); // 2026-10-06 12:00 本地
const MIN = 60 * 1000;

function emptyState() {
  return { strikes: {}, active: {}, restarts: [] };
}

function snapshot(opts = {}) {
  const snap = {
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
  // 开机恢复降噪：不传 uptimeSec 则不带 sys，保持既有用例（不涉及开机窗口）不变。
  if (opts.uptimeSec !== undefined) snap.sys = { uptimeSec: opts.uptimeSec };
  return snap;
}

test("群静默但单聊正常：连续 2 次后报警（单聊不掩蔽群）", () => {
  const snap = snapshot({ groupLastAt: NOON - 200 * MIN, singleLastAt: NOON - 5 * MIN });
  const first = evaluate(snap, emptyState(), cfgTight, NOON);
  assert.equal(first.strikes.group, 1);
  assert.equal(first.toAlert.length, 0, "第 1 次只累计，不报警");
  const second = evaluate(snap, first.nextState, cfgTight, NOON + 5 * MIN);
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
  const r = evaluate(snap, state, cfgTight, NOON);
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
  let r = evaluate(bad, emptyState(), cfgTight, NOON);
  r = evaluate(bad, r.nextState, cfgTight, NOON + 5 * MIN);
  assert.ok(r.active.group, "先进入告警中状态");

  const now2 = NOON + 10 * MIN;
  const good = snapshot({ groupLastAt: now2 - 1 * MIN, singleLastAt: now2 - 2 * MIN });
  const r2 = evaluate(good, r.nextState, cfgTight, now2);
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

// ================= 服务端对账（2026-10-07） =================
// 背景：群只有被 @ 才有消息，「群+单聊同时静默」常只是没人说话；
// 用 wecom-cli 会话列表（服务端最后消息时间）与本机 inbox 对账：服务端更新 → 真漏消息。

const { parseServerTime, lastByChat, reconcileSessions } = require("../src/watchdog");

test("parseServerTime：解 wecom-cli 的本地时间串，脏串返回 null", () => {
  assert.equal(parseServerTime("2026-10-07 14:04:00"), new Date(2026, 9, 7, 14, 4, 0).getTime());
  assert.equal(parseServerTime(" 2026-10-07T14:04:00 "), new Date(2026, 9, 7, 14, 4, 0).getTime());
  assert.equal(parseServerTime(""), null);
  assert.equal(parseServerTime("昨天"), null);
});

test("lastByChat：单聊按 fromUserId、群按 chatid，取每会话最后时间", () => {
  const text = [
    JSON.stringify({ chattype: "single", fromUserId: "u1", at: "2026-10-07T05:00:00.000Z" }),
    JSON.stringify({ chattype: "single", fromUserId: "u1", at: "2026-10-07T06:00:00.000Z" }),
    JSON.stringify({ chattype: "group", chatid: "g1", fromUserId: "u2", at: "2026-10-06T07:00:00.000Z" }),
    JSON.stringify({ chattype: "single", fromUserId: "", at: "2026-10-07T07:00:00.000Z" }),
    "半行垃圾"
  ].join("\n");
  const r = lastByChat(text);
  assert.equal(r.u1, Date.parse("2026-10-07T06:00:00.000Z"));
  assert.equal(r.g1, Date.parse("2026-10-06T07:00:00.000Z"));
  assert.equal(Object.keys(r).length, 2, "没键的行不进对账表");
});

test("reconcileSessions：服务端与本机一致 → 无漏；服务端更新 → 报漏", () => {
  const now = new Date(2026, 9, 7, 15, 0, 0).getTime();
  const 会话 = [
    { chat_id: "u1", chat_name: "黎路遥", last_msg_time: "2026-10-07 14:04:00" },
    { chat_id: "g1", chat_name: "«金牌组»", last_msg_time: "2026-10-06 15:51:09" }
  ];
  const 本机 = { u1: new Date(2026, 9, 7, 14, 4, 8).getTime(), g1: new Date(2026, 9, 6, 15, 51, 17).getTime() };
  assert.deepEqual(reconcileSessions(会话, 本机, DEFAULT_CONFIG, now).missed, [], "几十秒差不算漏");
  const 漏 = reconcileSessions(会话, { u1: 本机.u1 - 10 * MIN, g1: 本机.g1 }, DEFAULT_CONFIG, now).missed;
  assert.equal(漏.length, 1);
  assert.equal(漏[0].chatId, "u1");
  assert.equal(漏[0].chat, "黎路遥");
  assert.equal(漏[0].serverAt, new Date(2026, 9, 7, 14, 4, 0).getTime());
});

test("reconcileSessions：容差内不报（5分钟），超容差才报", () => {
  const now = new Date(2026, 9, 7, 15, 0, 0).getTime();
  const 会话 = [{ chat_id: "u1", chat_name: "黎路遥", last_msg_time: "2026-10-07 14:00:00" }];
  const 基准 = new Date(2026, 9, 7, 14, 0, 0).getTime();
  assert.equal(reconcileSessions(会话, { u1: 基准 - 4 * MIN }, DEFAULT_CONFIG, now).missed.length, 0, "差 4 分钟在容差内");
  assert.equal(reconcileSessions(会话, { u1: 基准 - 6 * MIN }, DEFAULT_CONFIG, now).missed.length, 1, "差 6 分钟超容差");
});

test("reconcileSessions：太旧的（>12h）不算、解不开的时间跳过", () => {
  const now = new Date(2026, 9, 7, 15, 0, 0).getTime();
  const 旧 = [{ chat_id: "u9", chat_name: "旧会话", last_msg_time: "2026-10-05 10:00:00" }];
  assert.equal(reconcileSessions(旧, {}, DEFAULT_CONFIG, now).missed.length, 0, "两天前的旧消息不报");
  const 脏 = [{ chat_id: "u1", chat_name: "x", last_msg_time: "not-a-time" }];
  assert.equal(reconcileSessions(脏, {}, DEFAULT_CONFIG, now).missed.length, 0);
});

test("evaluate + 对账一致：静默类不报（没人说话），已报的走恢复", () => {
  const snap = snapshot({ groupLastAt: NOON - 300 * MIN, singleLastAt: NOON - 200 * MIN });
  const recon = { checked: true, missed: [] };
  const r = evaluate(snap, emptyState(), cfg, NOON, recon);
  assert.equal(r.conditions.both.hit, false, "对账一致 → both 不算命中");
  assert.equal(r.toAlert.length, 0, "不再误报");
  const state = { strikes: { both: 2 }, active: { both: { since: NOON - 30 * MIN, lastAt: NOON - 30 * MIN } }, restarts: [] };
  const r2 = evaluate(snap, state, cfg, NOON, recon);
  assert.ok(r2.toResolve.some((x) => x.key === "both"), "已报过的要出 [已解决]");
});

test("evaluate + 对账发现漏消息：静默照报（调用方升 [故障]）", () => {
  const snap = snapshot({ groupLastAt: NOON - 300 * MIN, singleLastAt: NOON - 200 * MIN });
  const recon = { checked: true, missed: [{ chat: "黎路遥", chatId: "u1", serverAt: NOON - 5 * MIN, localAt: NOON - 200 * MIN }] };
  const r = evaluate(snap, emptyState(), cfg, NOON, recon);
  assert.equal(r.conditions.both.hit, true, "有漏消息时静默照样命中");
});

test("evaluate 不传 recon：维持原静默口径（向后兼容）", () => {
  const snap = snapshot({ groupLastAt: NOON - 300 * MIN, singleLastAt: NOON - 200 * MIN });
  const r = evaluate(snap, emptyState(), cfg, NOON);
  assert.equal(r.conditions.both.hit, true);
});

// ================= 开机恢复降噪（2026-10-08） =================
// 背景：过夜关机 → 开机后看门狗发现守护随关机停止（pid 文件残留），自动重启并确认恢复；
// 这属「开机恢复」而非故障，不应占用留言板（真故障/重启失败仍照旧报）。

test("开机窗口内守护缺席：daemon 告警带 boot 标记", () => {
  const snap = snapshot({ alive: false, uptimeSec: 60 });
  const r = evaluate(snap, emptyState(), cfg, NOON);
  const a = r.toAlert.find((x) => x.key === "daemon");
  assert.ok(a, "守护缺席应出 daemon 告警");
  assert.equal(a.boot, true);
});

test("开机 40 分钟后守护缺席：daemon 项不带 boot 真值（照旧报故障）", () => {
  const snap = snapshot({ alive: false, uptimeSec: 40 * 60 });
  const r = evaluate(snap, emptyState(), cfg, NOON);
  const a = r.toAlert.find((x) => x.key === "daemon");
  assert.ok(a);
  assert.ok(!a.boot, "超出默认开机窗口（30 分钟）不再标 boot");
});

test("bootRecoveryOnly：唯一 daemon+boot 且重启已验证恢复才为 true", () => {
  const daemonBoot = { key: "daemon", detail: "x", strikes: 1, boot: true };
  assert.equal(bootRecoveryOnly([daemonBoot], true), true);
  assert.equal(bootRecoveryOnly([daemonBoot], false), false, "未确认恢复不降噪");
  assert.equal(bootRecoveryOnly([daemonBoot, { key: "connection", detail: "x", strikes: 1, boot: false }], true), false, "混入连接告警不降噪");
  assert.equal(bootRecoveryOnly([{ key: "daemon", detail: "x", strikes: 1, boot: false }], true), false, "非开机窗口不降噪");
  assert.equal(bootRecoveryOnly([], true), false, "没有告警谈不上降噪");
});

test("bootGraceMin 可配置：1 分钟窗口外不再带 boot 标记", () => {
  const tight = mergeConfig(DEFAULT_CONFIG, { bootGraceMin: 1 });
  const inWin = evaluate(snapshot({ alive: false, uptimeSec: 30 }), emptyState(), tight, NOON);
  assert.equal(inWin.toAlert.find((x) => x.key === "daemon").boot, true);
  const outWin = evaluate(snapshot({ alive: false, uptimeSec: 2 * 60 }), emptyState(), tight, NOON);
  assert.ok(!outWin.toAlert.find((x) => x.key === "daemon").boot);
});

test("公告板轮换：开放贴里取编号最大的「公告板」贴", () => {
  const list = [
    { number: 5, title: "别的贴" },
    { number: 2, title: "机器人公告板（2）" },
    { number: 1, title: "机器人公告板" }
  ];
  assert.equal(pickBoardIssue(list, 1), 2, "旧贴还开着也应取新贴（最大号）");
  assert.equal(pickBoardIssue([{ number: 7, title: "机器人公告板（7）" }], 1), 7);
});

test("公告板轮换：没有公告板贴/列表为空/解析失败时退回兜底号", () => {
  assert.equal(pickBoardIssue([{ number: 9, title: "无关贴" }], 7), 7);
  assert.equal(pickBoardIssue([], 7), 7);
  assert.equal(pickBoardIssue(null, 7), 7);
  assert.equal(pickBoardIssue([{ number: "x", title: "机器人公告板" }], 7), 7, "编号不合法不算");
});
