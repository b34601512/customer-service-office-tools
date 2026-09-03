// 文案层测试：订单号行、判责事件、无链接。
const test = require("node:test");
const assert = require("node:assert");
const { buildAlertMessage } = require("../src/features/workOrderMonitor/messageText");

const META = { platformName: "京东", storeName: "京东3店", sourceName: "交易纠纷" };
const TK = { id: "84700001", ticketId: "84700001", orderId: "3581494008428198", decided: false, verdict: "" };

test("count_increase 附新增单订单号，且不包含链接", () => {
  const msg = buildAlertMessage({ type: "count_increase", at: Date.now(), meta: META, changes: [{ label: "可申诉", from: 0, to: 1, newItems: 1, tickets: [TK] }] });
  assert.match(msg, /【工单提醒】京东·京东3店 交易纠纷/);
  assert.match(msg, /· 可申诉：新增 1 单（0 → 1）/);
  assert.match(msg, /订单 3581494008428198（纠纷单 84700001）/);
  assert.ok(!/http/.test(msg), "文案不应有链接");
});

test("verdict_pending/verdict_decided 文案", () => {
  const pending = buildAlertMessage({ type: "verdict_pending", at: Date.now(), meta: META, label: "待处理", tickets: [TK] });
  assert.match(pending, /判责结果仍未出/);
  assert.match(pending, /订单 3581494008428198/);
  const decided = buildAlertMessage({ type: "verdict_decided", at: Date.now(), meta: META, label: "待处理", tickets: [{ ...TK, decided: true, verdict: "商家已和解" }] });
  assert.match(decided, /判责结果已出/);
  assert.match(decided, /商家已和解/);
});

test("超过5单截断防刷屏", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, ticketId: `1${i}${"1".repeat(6)}`, orderId: `3${"5".repeat(14)}`, decided: false, verdict: "" }));
  const msg = buildAlertMessage({ type: "verdict_pending", at: Date.now(), meta: META, label: "待处理", tickets: many });
  assert.match(msg, /…等共 7 单/);
});
