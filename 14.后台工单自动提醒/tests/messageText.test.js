// 文案层测试：最少必要内容——店铺缩写自带平台、只有订单号行、无链接/时间/平台名/纠纷单号/判责明细。
const test = require("node:test");
const assert = require("node:assert");
const { buildAlertMessage } = require("../src/features/workOrderMonitor/messageText");

const META = { platformName: "京东", storeName: "京东3店", sourceName: "交易纠纷" };
const TK = { id: "84700001", ticketId: "84700001", orderId: "3581494008428198", decided: false, verdict: "" };

test("count_increase：店铺缩写+订单号；无链接/时间/平台前缀/纠纷单号", () => {
  const msg = buildAlertMessage({ type: "count_increase", at: 1, meta: META, changes: [{ label: "可申诉", from: 0, to: 1, newItems: 1, tickets: [TK] }] });
  assert.strictEqual(msg.split("\n")[0], "【工单提醒】京东3店 交易纠纷");
  assert.match(msg, /· 可申诉：新增 1 单（0 → 1）/);
  assert.match(msg, /订单 3581494008428198/);
  assert.ok(!/http/.test(msg), "不应有链接");
  assert.ok(!/时间：/.test(msg), "不应有时间行");
  assert.ok(!/纠纷单/.test(msg), "不应有纠纷单号");
  assert.ok(!/^【工单提醒】京东·/.test(msg), "不应有平台名前缀（店铺缩写已含）");
  assert.ok(!/判责/.test(msg), "新单文案不提判责");
});

test("verdict_pending：只说未出+订单号；判责已出不再产生文案", () => {
  const pending = buildAlertMessage({ type: "verdict_pending", at: 1, meta: META, label: "待处理", tickets: [TK] });
  assert.match(pending, /【待处理】以下工单判责未出，请跟进：/);
  assert.match(pending, /· 订单 3581494008428198/);
  assert.ok(!/纠纷单 84700001/.test(pending));
});

test("值班行只保留本次@一行", () => {
  const plan = { atNames: ["李守耀"], mobiles: ["18923872211"], onDutyLine: "本次@：李守耀（组长值班）" };
  const msg = buildAlertMessage({ type: "count_increase", at: 1, meta: META, changes: [{ label: "待处理", from: 0, to: 1, newItems: 1 }], }, plan);
  assert.match(msg, /本次@：李守耀（组长值班）/);
  assert.ok(!/今日售后值班/.test(msg), "全员值班表不进群");
});

test("超过5单截断防刷屏", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, ticketId: "", orderId: `3${"5".repeat(14)}${i}`, decided: false, verdict: "" }));
  const msg = buildAlertMessage({ type: "verdict_pending", at: 1, meta: META, label: "待处理", tickets: many });
  assert.match(msg, /…等共 7 单/);
});

test("login_required 不带链接与时间", () => {
  const msg = buildAlertMessage({ type: "login_required", at: 1, meta: META, counts: {} });
  assert.match(msg, /登录态已失效/);
  assert.ok(!/http/.test(msg) && !/时间：/.test(msg));
});
