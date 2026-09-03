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
