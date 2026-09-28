// 反向断言测试：把「平台实测出来的硬限制」锁死，防止以后被顺手放开。
// 教训来源（2026-09-28，订单 260923-063795392132914）：
//   第一次提交 434 字 → POST /mercury/appeal/apply 返回「描述不能超过300字(3000000)」，提交失败。
const test = require("node:test");
const assert = require("node:assert");
const {
  DESCRIPTION_LIMIT, APPEAL_REASONS,
  textLength, validateDescription, validateAmount, validateEvidence, pickReason, summarizeItems
} = require("../src/lib/appealRules");

test("描述上限就是 300 字（改大之前先看平台报错）", () => {
  assert.equal(DESCRIPTION_LIMIT, 300);
});

test("描述 301 字必须被拦下，300 字放行", () => {
  const ok300 = "字".repeat(300);
  const bad301 = "字".repeat(301);
  assert.equal(validateDescription(ok300).ok, true);
  assert.equal(validateDescription(bad301).ok, false);
  assert.match(validateDescription(bad301).message, /300/);
});

test("中文字符按 1 个字计（不是字节）", () => {
  assert.equal(textLength("买家少件"), 4);
  assert.equal(validateDescription("买家少件").length, 4);
});

test("空描述被拦下", () => {
  assert.equal(validateDescription("").ok, false);
  assert.equal(validateDescription(null).ok, false);
});

test("金额不得超过本单上限，也不可为 0/负数", () => {
  assert.equal(validateAmount(150, 150).ok, true);
  assert.equal(validateAmount(151, 150).ok, false);
  assert.equal(validateAmount(0, 150).ok, false);
  assert.equal(validateAmount(-1, 150).ok, false);
  assert.equal(validateAmount("150", 150).ok, true); // 表单读回来是字符串
});

test("凭证：必填至少 1 张，必填/选填各最多 3 张", () => {
  assert.equal(validateEvidence(["a"]).ok, true);
  assert.equal(validateEvidence([]).ok, false);
  assert.equal(validateEvidence(["a", "b", "c", "d"]).ok, false);
  assert.equal(validateEvidence(["a"], ["1", "2", "3"]).ok, true);
  assert.equal(validateEvidence(["a"], ["1", "2", "3", "4"]).ok, false);
});

test("申诉原因必须从平台真实选项里精确选，不能自造", () => {
  assert.ok(pickReason("消费者反馈商品空包/少件/漏件，但实际未少发"));
  assert.equal(pickReason("我觉得买家是骗子"), null);
  assert.ok(APPEAL_REASONS.includes("消费者反馈商品空包/少件/漏件，但实际未少发"));
});

test("申诉项：默认货款申诉 + 纠纷退款率申诉都要勾", () => {
  const all = summarizeItems();
  assert.equal(all.ok, true);
  assert.deepEqual(all.items, ["货款申诉", "纠纷退款率申诉"]);
  assert.equal(summarizeItems(["货款申诉"]).ok, true);
  assert.equal(summarizeItems([]).ok, false);
});
