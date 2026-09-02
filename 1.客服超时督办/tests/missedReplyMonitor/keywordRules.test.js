const test = require("node:test");
const assert = require("node:assert/strict");

const {
  KEYWORD_MATCH_MODES,
  normalizeKeywordRule,
  normalizeKeywordRules,
  resolveKeywordMatchMode
} = require("../../src/features/missedReplyMonitor/keywordRules");

test("稍等类旧字符串默认按开头匹配", () => {
  const rule = normalizeKeywordRule("稍等", "temporary");

  assert.deepEqual(rule, {
    text: "稍等",
    matchMode: KEYWORD_MATCH_MODES.startsWith
  });
});

test("短临时关键词默认按完全匹配，避免误伤正常句子", () => {
  const rule = normalizeKeywordRule("1", "temporary");

  assert.deepEqual(rule, {
    text: "1",
    matchMode: KEYWORD_MATCH_MODES.exact
  });
});

test("中文匹配方式应该能识别成统一枚举", () => {
  assert.equal(resolveKeywordMatchMode("包含匹配"), KEYWORD_MATCH_MODES.includes);
  assert.equal(resolveKeywordMatchMode("开头匹配"), KEYWORD_MATCH_MODES.startsWith);
  assert.equal(resolveKeywordMatchMode("完全匹配"), KEYWORD_MATCH_MODES.exact);
});

test("对象关键词应该保留独立匹配方式", () => {
  const rules = normalizeKeywordRules(
    [
      { text: "稍等", matchMode: "exact" },
      { text: "看一下", matchMode: "includes" }
    ],
    "temporary"
  );

  assert.deepEqual(rules, [
    { text: "稍等", matchMode: KEYWORD_MATCH_MODES.exact },
    { text: "看一下", matchMode: KEYWORD_MATCH_MODES.includes }
  ]);
});
