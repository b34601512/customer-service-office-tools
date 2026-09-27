// 反向断言：把「上门换新取件登记」的判定口径钉死。
// 少判一项、把空值/老版粗判当通过、把「无需处理」写错一个字，这些测试都应该红。
const test = require("node:test");
const assert = require("node:assert/strict");
const { judgeOrder, cellText } = require("../src/features/exchange/registrationCheck");

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

test("规范登记：地址列空 + 三项无需处理 → ok", () => {
  const verdict = judgeOrder([row(28138, CLEAN)]);
  assert.equal(verdict.verdict, "ok");
  assert.deepEqual(verdict.problems, []);
});

test("地址列填了内容 → risk（填了地址工厂可能再寄一台）", () => {
  const dirty = CLEAN.concat([{ c: 10, v: "李娜 18466103809 陕西省 渭南市 大荔县 城关街道" }]);
  const verdict = judgeOrder([row(28138, dirty)]);
  assert.equal(verdict.verdict, "risk");
  assert.match(verdict.problems.join(" "), /地址列填了内容/);
});

test("三个选项任一没选「无需处理」→ risk（含空值）", () => {
  for (const index of [17, 18, 19]) {
    const dirty = CLEAN.filter((cell) => cell.c !== index);
    const verdict = judgeOrder([row(28138, dirty)]);
    assert.equal(verdict.verdict, "risk", `第 ${index} 列空着时应判风险`);
    assert.match(verdict.problems.join(" "), /应为「无需处理」/);
  }
  const wrong = CLEAN.map((cell) => (cell.c === 18 ? { c: 18, v: "厂家出" } : cell));
  assert.equal(judgeOrder([row(28138, wrong)]).verdict, "risk");
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
