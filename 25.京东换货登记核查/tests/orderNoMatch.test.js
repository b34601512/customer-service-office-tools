// 反向断言：订单号归一化匹配必须扛住「空格/零宽/全角」这些怀化表里的脏数据（用户 2026-09-27 指出）。
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeOrderNo, cellMatchesOrder, rowMatchesOrder } = require("../src/features/review/orderNoMatch");

test("夹了空格的订单号也能匹配上（用户手工时代要「清除特殊字符」的那种）", () => {
  assert.equal(cellMatchesOrder("5127 801625175058100", "5127801625175058100"), true);
  assert.equal(cellMatchesOrder(" 5127801625175058100 ", "5127801625175058100"), true);
  assert.equal(cellMatchesOrder("5127801625175058100\u3000", "5127801625175058100"), true);
});

test("零宽字符/BOM 不影响匹配", () => {
  assert.equal(cellMatchesOrder("5127801625175058100\u200b", "5127801625175058100"), true);
  assert.equal(cellMatchesOrder("\ufeff5127801625175058100", "5127801625175058100"), true);
});

test("全角数字与 Excel 文本前缀撇号不影响匹配", () => {
  assert.equal(cellMatchesOrder("'5127801625175058100", "5127801625175058100"), true);
  assert.equal(cellMatchesOrder("５１２７８０１６２５１７５０５８１００", "5127801625175058100"), true);
});

test("拼多多横杠单号：不同横杠字符/全角横杠都能对上", () => {
  assert.equal(normalizeOrderNo("260926－278396956242177"), normalizeOrderNo("260926-***********2177"));
  assert.equal(cellMatchesOrder("260926—278396956242177", "260926-***********2177"), true);
});

test("单元格里带别的单号（拼在一起）也能命中", () => {
  assert.equal(cellMatchesOrder("42998128651-SDO1023176563171", "1023176563171"), true);
});

test("短串不许误命中（少于 6 位直接不比）", () => {
  assert.equal(cellMatchesOrder("12345", "123"), false);
});

test("行匹配：任意一格命中就算命中", () => {
  assert.equal(rowMatchesOrder(["", "46251", "5127 801625175058100"], "5127801625175058100"), true);
  assert.equal(rowMatchesOrder(["", "46251", "9999999999999"], "5127801625175058100"), false);
});
