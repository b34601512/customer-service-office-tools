const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildUnresolvedReplyReminderMessage,
  formatDurationText,
  resolveAssigneeActionLine,
  resolveMissedReplyMentionPlan
} = require("../../src/features/missedReplyMonitor/missedReplyNotifier");

test("漏回复时长应该优先显示分钟", () => {
  assert.equal(formatDurationText(1500), "25分钟");
});

test("漏回复提醒文案不应该再展示第几次提醒", () => {
  const message = buildUnresolvedReplyReminderMessage({
    reminderKind: "missedReply",
    customerName: "罗马假日",
    pendingDurationSeconds: 1500,
    reasonLabel: "临时回复后未实质回复",
    assignmentStatus: "assigned",
    assignedToUserId: "staff_1",
    staffMentionText: "<@staff_1>",
    managerMentionText: "<@manager>"
  });

  assert.equal(
    message,
    [
      "<@manager>",
      "客户：罗马假日",
      "漏回复25分钟。",
      "<@staff_1>，请补充实质回复。",
      "原因：临时回复后未实质回复"
    ].join("\n")
  );
  assert.doesNotMatch(message, /第\d+次/);
});

test("未分配时应该写清楚由主管认领", () => {
  assert.equal(
    resolveAssigneeActionLine({ assignmentStatus: "unassigned", reminderKind: "timeout" }),
    "当前会话未分配客服，已提醒主管认领。"
  );
});

test("接待ID有值但成员表缺失时应该暴露具体ID", () => {
  assert.equal(
    resolveAssigneeActionLine({
      assignmentStatus: "member_mapping_missing",
      assignedToUserId: "staff_unknown",
      reminderKind: "timeout"
    }),
    "当前接待ID（staff_unknown）缺少成员映射，已提醒主管处理。"
  );
});

test("当前接待客服就是主管时不应该重复行内@", () => {
  const plan = resolveMissedReplyMentionPlan(
    {
      staffName: "黎路遥"
    },
    {
      memberMobileMap: {
        黎路遥: "13800000000"
      },
      memberUserIdMap: {
        黎路遥: "manager"
      },
      memberInlineMentionEnabledMap: {
        黎路遥: true
      }
    }
  );

  assert.equal(plan.staffMentionText, "<@manager>");
  assert.equal(plan.managerMentionText, "");
});

test("提醒名单只包含平台当前接待和主管", () => {
  const plan = resolveMissedReplyMentionPlan(
    {
      staffName: "卢安"
    },
    {
      memberMobileMap: {
        卢安: "13800000001",
        马倩: "13800000002",
        黎路遥: "13800000000"
      },
      memberUserIdMap: {
        卢安: "deng",
        马倩: "ke",
        黎路遥: "manager"
      },
      memberInlineMentionEnabledMap: {
        卢安: true,
        马倩: true,
        黎路遥: true
      }
    }
  );

  assert.equal(plan.staffMentionText, "<@deng>");
  assert.equal(plan.managerMentionText, "<@manager>");
  assert.deepEqual(plan.mentionedMobileList, []);
});
