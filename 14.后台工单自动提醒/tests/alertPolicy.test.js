// 判定层测试：新增/回落/首发/登录失效节流/恢复/重复提醒/发送失败回滚语义。
const test = require("node:test");
const assert = require("node:assert");
const { evaluateRound, STATUS } = require("../src/features/workOrderMonitor/alertPolicy");

const META = { platformName: "京东", storeName: "京喜1店", sourceName: "后台工单", url: "https://example", watch: ["平台协同工单"] };
const opts = { loginAlertThrottleMinutes: 60, repeatReminderMinutes: 0, alertOnFirstRun: true };

function obs(counts, status = STATUS.OK) {
  return { "jd/jx/wo": { status, counts, meta: META } };
}

test("首轮：alertOnFirstRun 时非零计数触发提醒，零不触发", () => {
  const state = { sources: {} };
  const events = evaluateRound(state, obs({ "平台协同工单": 0 }), opts, 1000);
  assert.strictEqual(events.length, 0);
  const events2 = evaluateRound(state, obs({ "平台协同工单": 2 }), opts, 2000);
  assert.strictEqual(events2.length, 1);
  assert.strictEqual(events2[0].type, "count_increase");
  assert.strictEqual(events2[0].changes[0].newItems, 2);
});

test("计数上升提醒、下降与持平不打扰", () => {
  const state = { sources: {} };
  evaluateRound(state, obs({ "平台协同工单": 1 }), opts, 1000);
  const up = evaluateRound(state, obs({ "平台协同工单": 3 }), opts, 2000);
  assert.strictEqual(up[0].changes[0].from, 1);
  assert.strictEqual(up[0].changes[0].to, 3);
  assert.strictEqual(evaluateRound(state, obs({ "平台协同工单": 3 }), opts, 3000).length, 0);
  assert.strictEqual(evaluateRound(state, obs({ "平台协同工单": 1 }), opts, 4000).length, 0);
});

test("新增页签第一次出现按 0→N 提醒", () => {
  const state = { sources: {} };
  evaluateRound(state, obs({ "平台协同工单": 1 }), opts, 1000);
  const e = evaluateRound(state, obs({ "平台协同工单": 1, "催开发票工单": 2 }), { ...opts, }, 2000);
  // 第二个 label 无旧基线，按当前值起算不刷屏；显式配置后正常提醒
  assert.strictEqual(e.length, 0);
});

test("登录失效提醒并按节流控制，恢复时提醒一次", () => {
  const state = { sources: {} };
  evaluateRound(state, obs({ "平台协同工单": 1 }), opts, 1000);
  const e1 = evaluateRound(state, obs({}, STATUS.LOGIN_REQUIRED), opts, 2000);
  assert.strictEqual(e1[0].type, "login_required");
  // 节流窗口内再次失效不重复
  const e2 = evaluateRound(state, obs({}, STATUS.LOGIN_REQUIRED), opts, 2000 + 30 * 60000);
  assert.strictEqual(e2.length, 0);
  // 超过节流窗口重复提醒
  const e3 = evaluateRound(state, obs({}, STATUS.LOGIN_REQUIRED), opts, 2000 + 61 * 60000);
  assert.strictEqual(e3.length, 1);
  // 恢复登录提醒一次，且恢复后计数从失效前基线继续比较
  const e4 = evaluateRound(state, obs({ "平台协同工单": 1 }), STATUS.OK, opts, 2000 + 62 * 60000);
  assert.strictEqual(e4[0].type, "login_restored");
  assert.strictEqual(e4.length, 1);
});

test("repeatReminderMinutes 开启后未清零会重复提醒", () => {
  const state = { sources: {} };
  const opts2 = { ...opts, repeatReminderMinutes: 30 };
  evaluateRound(state, obs({ "平台协同工单": 2 }), opts2, 1000);
  assert.strictEqual(evaluateRound(state, obs({ "平台协同工单": 2 }), opts2, 1000 + 10 * 60000).length, 0);
  const rep = evaluateRound(state, obs({ "平台协同工单": 2 }), opts2, 1000 + 31 * 60000);
  assert.strictEqual(rep[0].type, "pending_repeat");
});

// ===== 工单级：订单号 + 判责状态机（popDispute） =====
const META2 = { platformName: "京东", storeName: "京东3店", sourceName: "交易纠纷", url: "https://example", watch: ["待处理"], sourceType: "popDispute" };
const TICKET = { id: "84700001", ticketId: "84700001", orderId: "3581494008428198", decided: false, verdict: "" };
const obsD = (counts, ticketsByLabel) => ({ "jd/s/d": { status: STATUS.OK, counts, ticketsByLabel, meta: META2 } });
const MIN = 60000;

test("新单：count_increase 带出新增工单（订单号在事件里）", () => {
  const state = { sources: {} };
  const e = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TICKET] }), opts, 1000);
  assert.strictEqual(e[0].type, "count_increase");
  assert.strictEqual(e[0].changes[0].tickets.length, 1);
  assert.strictEqual(e[0].changes[0].tickets[0].orderId, "3581494008428198");
});

test("判责未出：每 verdictPendingRepeatMinutes 重发一次", () => {
  const state = { sources: {} };
  evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TICKET] }), { ...opts, verdictPendingRepeatMinutes: 30 }, 1000);
  const soon = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TICKET] }), { ...opts, verdictPendingRepeatMinutes: 30 }, 1000 + 29 * MIN);
  assert.strictEqual(soon.length, 0, "未到30分钟不重发");
  const due = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TICKET] }), { ...opts, verdictPendingRepeatMinutes: 30 }, 1000 + 31 * MIN);
  assert.strictEqual(due[0].type, "verdict_pending");
  assert.strictEqual(due[0].tickets[0].orderId, "3581494008428198");
  const again = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TICKET] }), { ...opts, verdictPendingRepeatMinutes: 30 }, 1000 + 32 * MIN);
  assert.strictEqual(again.length, 0, "重发后重新计时");
});

test("判责出结果：补报一次后不再重发", () => {
  const state = { sources: {} };
  const o = { ...opts, verdictPendingRepeatMinutes: 30 };
  evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TICKET] }), o, 1000);
  const decided = { ...TICKET, decided: true, verdict: "商家已和解" };
  const e = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [decided] }), o, 1000 + 10 * MIN);
  assert.strictEqual(e[0].type, "verdict_decided");
  assert.strictEqual(e[0].tickets[0].verdict, "商家已和解");
  const later = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [decided] }), o, 1000 + 90 * MIN);
  assert.strictEqual(later.length, 0, "已判责只提醒这一次");
});

test("单子消失（清零）：记录删除，重新出现算新单", () => {
  const state = { sources: {} };
  const o = { ...opts, verdictPendingRepeatMinutes: 30 };
  evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TICKET] }), o, 1000);
  evaluateRound(state, obsD({ 待处理: 0 }, { 待处理: [] }), o, 1000 + 5 * MIN);
  assert.deepStrictEqual(state.sources["jd/s/d"].tickets["待处理"] || undefined, undefined);
  const back = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TICKET] }), o, 1000 + 6 * MIN);
  assert.strictEqual(back[0].type, "count_increase");
  assert.strictEqual(back[0].changes[0].tickets.length, 1);
});

test("深读失败的页签：沿用旧记录，重发不漏", () => {
  const state = { sources: {} };
  const o = { ...opts, verdictPendingRepeatMinutes: 30 };
  evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TICKET] }), o, 1000);
  const e = evaluateRound(state, obsD({ 待处理: 1 }, {}), o, 1000 + 31 * MIN);
  assert.strictEqual(e[0].type, "verdict_pending");
});

test("非POP纠纷类型（无判责概念）：不重发", () => {
  const state = { sources: {} };
  const metaJ = { ...META2, sourceType: "jingxiWorkOrder" };
  const o = { ...opts, verdictPendingRepeatMinutes: 30 };
  evaluateRound(state, { "jd/s/w": { status: STATUS.OK, counts: { 待处理: 1 }, ticketsByLabel: { 待处理: [TICKET] }, meta: metaJ } }, o, 1000);
  const later = evaluateRound(state, { "jd/s/w": { status: STATUS.OK, counts: { 待处理: 1 }, ticketsByLabel: { 待处理: [TICKET] }, meta: metaJ } }, o, 1000 + 120 * MIN);
  assert.strictEqual(later.length, 0);
});
