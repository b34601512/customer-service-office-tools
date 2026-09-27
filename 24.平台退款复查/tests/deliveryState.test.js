// 物流状态判定（用户 2026-09-27 口径：还在路上的不用管）
// 反向断言：把「在途 = 不用管」和「已签收 = 风险」钉死，防止以后有人图省事把物流这一步删掉。
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyDelivery } = require("../src/features/review/deliveryState");

test("运输中 / 物流异常 / 拒收 / 已出库 = 在途，不用管", () => {
  for (const state of ["运输中", "物流异常", "拒收", "已出库"]) {
    const hit = classifyDelivery(state);
    assert.equal(hit.kind, "in_transit", `${state} 应判在途`);
    assert.equal(hit.skip, true, `${state} 应可跳过`);
  }
});

test("已签收 = 真风险（客户手里，货没退回来）", () => {
  const hit = classifyDelivery("已签收");
  assert.equal(hit.kind, "signed");
  assert.equal(hit.skip, false);
});

test("空 / 未知状态不许当「不用管」放过", () => {
  assert.equal(classifyDelivery("").kind, "unknown");
  assert.equal(classifyDelivery("").skip, false);
  assert.equal(classifyDelivery("宇宙漫游中").kind, "unknown");
  assert.equal(classifyDelivery("宇宙漫游中").skip, false);
  assert.match(classifyDelivery("宇宙漫游中").label, /宇宙漫游中/);
});

test("前后空格不影响判定（接口值可能带空白）", () => {
  assert.equal(classifyDelivery(" 运输中 ").kind, "in_transit");
  assert.equal(classifyDelivery("已签收 ").kind, "signed");
});
