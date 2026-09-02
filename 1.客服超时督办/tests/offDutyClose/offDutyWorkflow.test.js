const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildActionSummary,
  isMemberAlreadyClosed
} = require("../../src/features/offDutyClose/offDutyWorkflow");

test("成员关闭态判断应该要求接待数为 0 且两个开关都已关闭", () => {
  assert.equal(
    isMemberAlreadyClosed({
      currentConversationCount: 0,
      autoAssignEnabled: false,
      transferEnabled: false
    }),
    true
  );

  assert.equal(
    isMemberAlreadyClosed({
      currentConversationCount: 0,
      autoAssignEnabled: true,
      transferEnabled: false
    }),
    false
  );

  assert.equal(
    isMemberAlreadyClosed({
      currentConversationCount: 2,
      autoAssignEnabled: false,
      transferEnabled: false
    }),
    false
  );
});

test("下班动作摘要应该输出当前状态口径", () => {
  assert.equal(
    buildActionSummary(["关闭是否可被转接"]),
    "当前状态：是否可被转接【已关闭】"
  );

  assert.equal(
    buildActionSummary(["关闭自动分配", "关闭是否可被转接"]),
    "当前状态：自动分配【已关闭】；是否可被转接【已关闭】"
  );
});
