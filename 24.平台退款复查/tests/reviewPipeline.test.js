// 24号 平台适配器的回归测试：node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const { PLATFORMS } = require("../src/features/review/reviewPipeline");

test("tmall 从申诉清单取 orderId", () => {
  const orders = PLATFORMS.tmall.extractOrders({ items: [{ orderId: "3316420742065069564" }, { orderId: "" }] });
  assert.deepEqual(orders, ["3316420742065069564"]);
  assert.ok(PLATFORMS.tmall.orderIdPattern.test("3316420742065069564"));
});

test("pdd 从申诉清单取 orderSn（带横杠）", () => {
  const orders = PLATFORMS.pdd.extractOrders({ items: [{ orderSn: "260818-088971753771335" }, { orderSn: "" }] });
  assert.deepEqual(orders, ["260818-088971753771335"]);
  assert.ok(PLATFORMS.pdd.orderIdPattern.test("260818-088971753771335"));
});

test("单号正则：pdd 放行横杠单号、拒绝空/怪字符", () => {
  assert.ok(PLATFORMS.pdd.orderIdPattern.test("260818-088971753771335"));
  assert.ok(!PLATFORMS.pdd.orderIdPattern.test("260818-088971753771335x"));
  assert.ok(!PLATFORMS.pdd.orderIdPattern.test("abc-def"));
  assert.ok(PLATFORMS.tmall.orderIdPattern.test("5127801625175058100"));
});

test("报告里的申诉信息展示：天猫含退款编号，拼多多含类型/金额/剩余", () => {
  const tmallText = PLATFORMS.tmall.appealText({ refundId: "409407157458213921", handleType: "仅退款", leftHours: 717.3 });
  assert.match(tmallText, /409407157458213921/);
  assert.match(tmallText, /717\.3h/);
  const pddText = PLATFORMS.pdd.appealText({ tab: "维权申诉", refundAmountYuan: 488, expireRemainHours: 3.1 });
  assert.match(pddText, /维权申诉/);
  assert.match(pddText, /488/);
  assert.match(pddText, /3\.1h/);
});
