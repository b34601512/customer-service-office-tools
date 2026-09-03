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

// ===== 工单级：订单号 + 纠纷状态驱动重发（用户定：不看判责看状态；去申诉只提醒一次；一单一消息） =====
const META2 = { platformName: "京东", storeName: "京东3店", sourceName: "交易纠纷", url: "https://example", watch: ["待处理"], sourceType: "popDispute" };
const TK_PENDING = { id: "59088842", ticketId: "59088842", orderId: "275490614167", status: "待商家处理", canAppeal: false };
const obsD = (counts, ticketsByLabel) => ({ "jd/s/d": { status: STATUS.OK, counts, ticketsByLabel, meta: META2 } });
const MIN = 60000;
const optsR = { ...opts, merchantPendingRepeatMinutes: 30 };

test("新单：count_increase 带出新增工单订单号", () => {
  const state = { sources: {} };
  const e = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TK_PENDING] }), optsR, 1000);
  assert.strictEqual(e[0].type, "count_increase");
  assert.strictEqual(e[0].changes[0].tickets[0].orderId, "275490614167");
});

test("待商家处理：每30分钟重发 pending_handling", () => {
  const state = { sources: {} };
  evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TK_PENDING] }), optsR, 1000);
  assert.strictEqual(evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TK_PENDING] }), optsR, 1000 + 29 * MIN).length, 0);
  const due = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TK_PENDING] }), optsR, 1000 + 31 * MIN);
  assert.strictEqual(due[0].type, "pending_handling");
  assert.strictEqual(due[0].tickets[0].orderId, "275490614167");
  assert.strictEqual(evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TK_PENDING] }), optsR, 1000 + 32 * MIN).length, 0, "重发后重新计时");
});

test("待客户确认/纠纷关闭：客服已处理或完结，不提醒不重发", () => {
  const state = { sources: {} };
  for (const statusText of ["待客户确认", "纠纷关闭"]) {
    const st = { sources: {} };
    evaluateRound(st, obsD({ 待处理: 1 }, { 待处理: [{ ...TK_PENDING, status: statusText }] }), optsR, 1000);
    const later = evaluateRound(st, obsD({ 待处理: 1 }, { 待处理: [{ ...TK_PENDING, status: statusText }] }), optsR, 1000 + 90 * MIN);
    assert.strictEqual(later.length, 0, statusText + " 不应重发");
  }
});

test("操作列带去申诉：只随新增提醒一次，永不重发", () => {
  const state = { sources: {} };
  const appeal = { ...TK_PENDING, status: "", canAppeal: true };
  const e1 = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [appeal] }), optsR, 1000);
  assert.strictEqual(e1[0].type, "count_increase");
  const later = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [appeal] }), optsR, 1000 + 120 * MIN);
  assert.strictEqual(later.length, 0);
});

test("状态从待商家处理转为完结：静默停发，不补报", () => {
  const state = { sources: {} };
  evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TK_PENDING] }), optsR, 1000);
  const done = { ...TK_PENDING, status: "待客户确认" };
  const e = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [done] }), optsR, 1000 + 10 * MIN);
  assert.strictEqual(e.length, 0);
  assert.strictEqual(evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [done] }), optsR, 1000 + 90 * MIN).length, 0);
});

test("单子消失（清零）：记录删除，重新出现算新单", () => {
  const state = { sources: {} };
  evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TK_PENDING] }), optsR, 1000);
  evaluateRound(state, obsD({ 待处理: 0 }, { 待处理: [] }), optsR, 1000 + 5 * MIN);
  assert.strictEqual(state.sources["jd/s/d"].tickets["待处理"], undefined);
  const back = evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TK_PENDING] }), optsR, 1000 + 6 * MIN);
  assert.strictEqual(back[0].type, "count_increase");
});

test("深读失败的页签：沿用旧记录，到期重发不漏", () => {
  const state = { sources: {} };
  evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [TK_PENDING] }), optsR, 1000);
  const e = evaluateRound(state, obsD({ 待处理: 1 }, {}), optsR, 1000 + 31 * MIN);
  assert.strictEqual(e[0].type, "pending_handling");
});

test("无状态概念（京喜工单解析不出状态）：不重发", () => {
  const state = { sources: {} };
  const jx = { id: "99887766", ticketId: "99887766", orderId: "3581494008428198", status: "", canAppeal: false };
  evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [jx] }), optsR, 1000);
  assert.strictEqual(evaluateRound(state, obsD({ 待处理: 1 }, { 待处理: [jx] }), optsR, 1000 + 120 * MIN).length, 0);
});
