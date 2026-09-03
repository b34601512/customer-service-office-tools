// 文案层测试：一单一消息 + 最少必要内容（无链接/时间/平台前缀/纠纷单号/判责字样）。
const test = require("node:test");
const assert = require("node:assert");
const { buildAlertMessages } = require("../src/features/workOrderMonitor/messageText");

const META = { platformName: "京东", storeName: "京东3店", sourceName: "交易纠纷" };
const TK1 = { id: "84700001", ticketId: "84700001", orderId: "3581494008428198", status: "待商家处理", canAppeal: false };
const TK2 = { id: "59088842", ticketId: "59088842", orderId: "275490614167", status: "待商家处理", canAppeal: false };
const PLAN = { atNames: ["李守耀"], mobiles: ["18923872211"], onDutyLine: "本次@：李守耀（组长值班）" };

test("count_increase 两单 → 拆成两条消息，各含各的订单号", () => {
  const msgs = buildAlertMessages({ type: "count_increase", at: 1, meta: META, changes: [{ label: "可申诉", from: 0, to: 2, newItems: 2, tickets: [TK1, TK2] }] });
  assert.strictEqual(msgs.length, 2);
  assert.match(msgs[0], /订单 3581494008428198/);
  assert.ok(!/275490614167/.test(msgs[0]), "一条消息不混另一单");
  assert.match(msgs[1], /订单 275490614167/);
});

test("最少必要：无链接/时间/平台前缀/纠纷单号/判责字样", () => {
  const msgs = buildAlertMessages({ type: "count_increase", at: 1, meta: META, changes: [{ label: "可申诉", from: 0, to: 1, newItems: 1, tickets: [TK1] }] });
  const m = msgs[0];
  assert.strictEqual(m.split("\n")[0], "【工单提醒】京东3店 交易纠纷");
  assert.ok(!/http/.test(m));
  assert.ok(!/时间：/.test(m));
  assert.ok(!/京东·/.test(m));
  assert.ok(!/纠纷单/.test(m));
  assert.ok(!/判责/.test(m), "群里不再出现判责字样");
});

test("pending_handling：一单一条，写待商家处理", () => {
  const msgs = buildAlertMessages({ type: "pending_handling", at: 1, meta: META, label: "待处理", tickets: [TK1, TK2] }, PLAN);
  assert.strictEqual(msgs.length, 2);
  assert.match(msgs[0], /【待处理】订单 3581494008428198 待商家处理，请尽快跟进。/);
  assert.match(msgs[0], /本次@：李守耀（组长值班）/);
});

test("深读失败没拿到单号：按页签一条兜底", () => {
  const msgs = buildAlertMessages({ type: "count_increase", at: 1, meta: META, changes: [{ label: "待处理", from: 0, to: 3, newItems: 3 }] });
  assert.strictEqual(msgs.length, 1);
  assert.match(msgs[0], /· 待处理：新增 3 单（0 → 3）/);
  assert.ok(!/订单/.test(msgs[0]));
});

test("无 orderId 时用单号兜底；login 事件各一条", () => {
  const msgs = buildAlertMessages({ type: "pending_handling", at: 1, meta: META, label: "待处理", tickets: [{ id: "998877", status: "待商家处理" }] });
  assert.match(msgs[0], /单号 998877/);
  assert.strictEqual(buildAlertMessages({ type: "login_required", at: 1, meta: META }).length, 1);
  assert.strictEqual(buildAlertMessages({ type: "login_restored", at: 1, meta: META }).length, 1);
});
