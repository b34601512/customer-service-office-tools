const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOffDutyClosedMessage
} = require("../../src/features/offDutyClose/offDutyNotifier");

test("下班收尾文案在有 userid 时应该支持行内@", () => {
  const message = buildOffDutyClosedMessage({
    staffName: "唐悦",
    staffMentionText: "<@xujianan>",
    actionSummary: "当前状态：是否可被转接【已关闭】",
    tomorrowShiftLabel: "早班",
    tomorrowShiftNotificationEnabled: true
  });

  assert.equal(
    message,
    [
      "<@xujianan>，已帮你处理下班收尾。",
      "当前状态：是否可被转接【已关闭】。",
      "明天班次：早班",
      "安心下班。"
    ].join("\n")
  );
});
