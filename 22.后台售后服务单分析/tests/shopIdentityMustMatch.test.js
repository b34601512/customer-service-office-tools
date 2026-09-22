// 反向断言（2026-09-22 事故锁死）：抖音共享账号两店共用一个 profile，
// `probe-page --store douyin5` 打开的窗口停在上次那家店，douyin5 的概览读到的是 douyin3 的数字
// （当天两店计数一模一样、体验分同为 84 才露馅）→ 必须在店名不一致时拒绝出结论。
const test = require("node:test");
const assert = require("node:assert");
const { 校验当前店 } = require("../src/tools/shop-identity");

test("店名一致 → 通过（容忍首尾空白）", () => {
  const r = 校验当前店("DEDAKJ医疗器械旗舰店", "  DEDAKJ医疗器械旗舰店 ");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.需人工, false);
});

test("店名不一致 → 拒绝，并指明要先切店（当天真实事故组合）", () => {
  const r = 校验当前店("DEDAKJ医疗器械旗舰店", "德达医疗康养器械旗舰店");
  assert.strictEqual(r.ok, false);
  assert.match(r.理由, /德达医疗康养器械旗舰店/);
  assert.match(r.理由, /切店/);
});

test("读不到页面店名 → 拒绝且标需人工，不许当目标店", () => {
  for (const 缺失 of ["", null, undefined, "   "]) {
    const r = 校验当前店("德达医疗康养器械旗舰店", 缺失);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.需人工, true, "读不到店名必须停下来问人");
    assert.match(r.理由, /不许/);
  }
});

test("目标店名缺失同样是拒绝（不能两边都空而误判通过）", () => {
  const r = 校验当前店("", "");
  assert.strictEqual(r.ok, false);
});
