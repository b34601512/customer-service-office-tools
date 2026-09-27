// 反向断言：把「上门换新取件登记」的判定口径钉死。
// 口径（用户 2026-09-27 修正过）：**空着没事，填多了才有问题**（填了地址 → 工厂可能重复换货）。
// 谁要是把「空值当问题」改回来、或漏判「地址非空」，这些测试都要红。
const test = require("node:test");
const assert = require("node:assert/strict");
const { judgeOrder, cellText, informationalOf } = require("../src/features/exchange/registrationCheck");

// 帮忙造一行规整登记（c=列号, v=文字），只放非空单元格——与金山脚本返回的形态一致
function row(rowNumber, cells) {
  return { row: rowNumber, cells };
}
const CLEAN = [
  { c: 0, v: "46269" },
  { c: 1, v: "制氧机" },
  { c: 6, v: "JD01" },
  { c: 13, v: "3603429015951515" },
  { c: 14, v: "不通电" },
  { c: 16, v: "收到后直接入库。我已经给客户提前换出了" },
  { c: 17, v: "无需处理" },
  { c: 18, v: "无需处理" },
  { c: 19, v: "无需处理" },
  { c: 22, v: "李守耀" },
  { c: 23, v: "客户申请了上门换新服务" }
];

test("规范登记：地址空 + 三项无需处理 → ok", () => {
  const verdict = judgeOrder([row(28138, CLEAN)]);
  assert.equal(verdict.verdict, "ok");
  assert.deepEqual(verdict.problems, []);
});

test("三个选项列空着 → 仍然 ok（用户 2026-09-27 拍板：空着没事）", () => {
  const blank = CLEAN.filter((cell) => [17, 18, 19].indexOf(cell.c) < 0);
  const verdict = judgeOrder([row(27378, blank)]);
  assert.equal(verdict.verdict, "ok", "空值不许再当问题");
  assert.deepEqual(verdict.problems, []);
});

test("地址列填了内容 → risk（这是唯一会害工厂重复换货的填写）", () => {
  const dirty = CLEAN.concat([{ c: 10, v: "李娜 18466103809 陕西省 渭南市 大荔县 城关街道" }]);
  const verdict = judgeOrder([row(28138, dirty)]);
  assert.equal(verdict.verdict, "risk");
  assert.match(verdict.problems.join(" "), /地址列填了/);
});

test("选项列填了别的值 → warn（待核，不是直接判风险）", () => {
  const filled = CLEAN.map((cell) => (cell.c === 18 ? { c: 18, v: "厂家承担" } : cell));
  const verdict = judgeOrder([row(28138, filled)]);
  assert.equal(verdict.verdict, "warn");
  assert.match(verdict.problems.join(" "), /厂家承担/);
});

test("地址非空 + 选项填了值 → risk（风险优先级高于 warn）", () => {
  const both = CLEAN.concat([{ c: 10, v: "某某 13800000000 湖南省 怀化市" }, { c: 17, v: "保修期内" }]);
  assert.equal(judgeOrder([row(28138, both)]).verdict, "risk");
});

test("没登记 → missing（不是 ok，也不是 risk）", () => {
  const verdict = judgeOrder([]);
  assert.equal(verdict.verdict, "missing");
  assert.match(verdict.problems.join(" "), /未登记/);
});

test("老版脚本（没有列号 cells）不许当通过 → coarse", () => {
  const verdict = judgeOrder([{ row: 28138, values: ["制氧机", "无需处理", "无需处理", "无需处理"] }]);
  assert.equal(verdict.verdict, "coarse");
  assert.notEqual(verdict.verdict, "ok");
});

test("cellText：列不存在返回空串、没 cells 返回 null（两者含义不同）", () => {
  assert.equal(cellText(CLEAN, 10), "");      // 地址列没值 = 空（规范）
  assert.equal(cellText(CLEAN, 17), "无需处理");
  assert.equal(cellText(undefined, 10), null); // 拿不到列号
});

test("处理方式/备注只抓原文，不参与判定（自由文本交模型读）", () => {
  const info = informationalOf(CLEAN);
  assert.equal(info["处理方式"], "收到后直接入库。我已经给客户提前换出了");
  assert.equal(info["备注"], "客户申请了上门换新服务");
});
