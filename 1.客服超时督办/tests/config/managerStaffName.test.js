const test = require("node:test");
const assert = require("node:assert/strict");
const appConfig = require("../../src/config/appConfig");
const { resolveManagerStaffName } = require("../../src/config/managerStaffName");
const { resolveMissedReplyMentionPlan } = require("../../src/features/missedReplyMonitor/missedReplyNotifier");

test("主管提醒使用本机配置，不写死原作者姓名", () => {
  const previous = appConfig.managerStaffName;
  try {
    appConfig.managerStaffName = "王主管";
    const result = resolveMissedReplyMentionPlan({}, { memberMobileMap: { 王主管: "13800000009" }, memberUserIdMap: {}, memberInlineMentionEnabledMap: {} });
    assert.deepEqual(result.mentionedMobileList, ["13800000009"]);
    appConfig.managerStaffName = "";
    assert.throws(resolveManagerStaffName, /填写主管姓名/);
  } finally { appConfig.managerStaffName = previous; }
});
