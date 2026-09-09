const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isMarkedBackgroundColor,
  normalizeBackgroundColor
} = require("../../src/features/scheduleQuery/scheduleStyleParser");

test("应该把 KDocs RGB 整数转换成标准背景色", () => {
  assert.equal(normalizeBackgroundColor(14872793), "#E2F0D9");
});

test("无填充和白色不应该被视为值班标记", () => {
  assert.equal(isMarkedBackgroundColor(""), false);
  assert.equal(isMarkedBackgroundColor("#FFFFFF"), false);
  assert.equal(isMarkedBackgroundColor("rgb(226, 240, 217)"), true);
});
