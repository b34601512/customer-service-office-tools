const test = require("node:test");
const assert = require("node:assert/strict");

const { parseMemberNameCellText } = require("../../src/features/offDutyClose/memberSettingsPage");

test("应该能从成员单元格文本里拆出姓名和角色", () => {
  assert.deepEqual(parseMemberNameCellText("马倩（售后客服）"), {
    memberName: "马倩",
    roleLabel: "售后客服"
  });
  assert.deepEqual(parseMemberNameCellText("运营 运营 我"), {
    memberName: "运营",
    roleLabel: "运营"
  });
});
