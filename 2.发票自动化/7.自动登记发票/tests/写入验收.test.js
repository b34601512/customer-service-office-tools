// 7号：写入验收（写前/写后对比）测试 —— 用户 2026-09-30 要求「写前记录、写后记录、对比，避免覆盖别的人」。
const test = require("node:test");
const assert = require("node:assert");
const { 解析行值, 归一, 抓快照, 对比快照 } = require("../src/写入验收");

test("解析行值：把 dump 的 'A=1 | J=xxx' 解析成对象，公式尾巴去掉", () => {
  const 行 = 解析行值(["A=46289", "J=dedayl6620260923001", "AK=46269 ⟵ =TODAY()", "乱码", "=5"]);
  assert.strictEqual(行.A, "46289");
  assert.strictEqual(行.J, "dedayl6620260923001");
  assert.strictEqual(行.AK, "46269");
  assert.strictEqual(Object.keys(行).length, 3);
});

test("归一：数字按数值比，长订单号按文本比（不丢精度）", () => {
  assert.strictEqual(归一(499), 归一("499"));
  assert.strictEqual(归一("499.00"), 归一("499"));
  assert.strictEqual(归一("5127724117341157631"), "5127724117341157631");
  assert.notStrictEqual(归一("5127724117341157631"), 归一("5127724117341157632"));
  assert.strictEqual(归一(undefined), "");
});

test("抓快照：只收目标子表的行", async () => {
  const 跑读脚本 = async () => ({ scriptVersion: "t", dump: [
    { sheet: "科技--唐雪梅", row: 10497, values: ["F=正常", "G=普票"] },
    { sheet: "别的表", row: 10497, values: ["F=正常"] },
  ] });
  const 快照 = await 抓快照(跑读脚本, "科技--唐雪梅", 10495, 10499);
  assert.deepStrictEqual(Object.keys(快照.行), ["10497"]);
});

test("对比快照：正常写入 → 通过", () => {
  const 前 = { 行: { 10496: { J: "3316436294127001984" }, 10497: { F: "正常", G: "普票" } } };
  const 后 = { 行: { 10496: { J: "3316436294127001984" }, 10497: { A: "46295", F: "正常", G: "普票", I: "天猫6店", J: "5127724117341157631", Y: "499" } }, 下一个可写行: 10498 };
  const 结果 = 对比快照(前, 后, 10497, { A: 46295, F: "正常", G: "普票", I: "天猫6店", J: "5127724117341157631", Y: 499 }, 1);
  assert.strictEqual(结果.通过, true);
  assert.deepStrictEqual(结果.问题, []);
});

test("对比快照：动了别人的行 → 不通过并点名那一行", () => {
  const 前 = { 行: { 10496: { J: "3316436294127001984" } } };
  const 后 = { 行: { 10496: { J: "被覆盖了" } }, 下一个可写行: 10498 };
  const 结果 = 对比快照(前, 后, 10497, { J: "5127724117341157631" }, 1);
  assert.strictEqual(结果.通过, false);
  assert.ok(结果.问题.some((句) => 句.includes("10496") && 句.includes("覆盖")));
});

test("对比快照：目标行缺列 / 订单号不对 → 不通过", () => {
  const 前 = { 行: {} };
  const 后 = { 行: { 10497: { A: "46295", J: "别的订单号" } }, 下一个可写行: 10498 };
  const 结果 = 对比快照(前, 后, 10497, { A: 46295, J: "5127724117341157631", Y: 499 }, 1);
  assert.strictEqual(结果.通过, false);
  assert.ok(结果.问题.some((句) => 句.includes("Y 列")));
  assert.ok(结果.问题.some((句) => 句.includes("订单号没对上")));
});

test("对比快照：行数不对（下一个可写行没 +1）→ 不通过", () => {
  const 前 = { 行: {} };
  const 后 = { 行: { 10497: { J: "5127724117341157631" } }, 下一个可写行: 10500 };
  const 结果 = 对比快照(前, 后, 10497, { J: "5127724117341157631" }, 1);
  assert.strictEqual(结果.通过, false);
  assert.ok(结果.问题.some((句) => 句.includes("下一个可写行")));
});

test("对比快照：写后读不到目标行 → 不通过", () => {
  const 结果 = 对比快照({ 行: {} }, { 行: {}, 下一个可写行: 10498 }, 10497, { J: "x" }, 1);
  assert.strictEqual(结果.通过, false);
  assert.ok(结果.问题.some((句) => 句.includes("读不到第 10497 行")));
});
