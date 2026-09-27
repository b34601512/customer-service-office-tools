// 24号 判定核心的回归测试：node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyOrder } = require("../src/features/review/safetyClassify");

test("ERP 无此单 → 待人工核", () => {
  assert.equal(classifyOrder({ erp: null, torn: [], returned: false }), "待人工核-ERP无此单");
});

test("ERP 已作废优先于发货状态 → 安全", () => {
  assert.equal(classifyOrder({ erp: { cancel: true, deliveryState: 2, approve: true }, torn: [], returned: false }), "安全-ERP已作废");
});

test("已发货 + 退货表搜到 → 安全-已登记退货", () => {
  assert.equal(classifyOrder({ erp: { cancel: false, deliveryState: 2, approve: true }, torn: [], returned: true }), "安全-已登记退货");
});

test("已发货 + 退货表搜不到 → 风险（核心要抓的双重损失）", () => {
  assert.equal(classifyOrder({ erp: { cancel: false, deliveryState: 2, approve: true }, torn: [], returned: false }), "风险-已发货未登记退货");
});

test("部分发货（deliveryState=1）也算已发货", () => {
  assert.equal(classifyOrder({ erp: { cancel: false, deliveryState: 1, approve: true }, torn: [], returned: false }), "风险-已发货未登记退货");
});

test("未发货 + 撕单表有记录 → 待读撕单状态（不许程序关键词判）", () => {
  assert.equal(classifyOrder({ erp: { cancel: false, deliveryState: 0, approve: true }, torn: [{ status: "已撕单" }], returned: false }), "待读撕单状态");
});

test("未发货 + 撕单表无记录 + 已审核 → 风险-已审单未撕单", () => {
  assert.equal(classifyOrder({ erp: { cancel: false, deliveryState: 0, approve: true }, torn: [], returned: false }), "风险-已审单未撕单");
});

test("未发货 + 未审核 → 观察", () => {
  assert.equal(classifyOrder({ erp: { cancel: false, deliveryState: 0, approve: false }, torn: [], returned: false }), "观察-未发货未审核");
});
