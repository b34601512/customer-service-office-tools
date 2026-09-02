const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTransferReminderMessage,
  resolveTransferReminderMentionPlan
} = require("../../src/features/transferMonitor/transferNotifier");

test("转接提醒文案在有 userid 时应该使用行内@", () => {
  const message = buildTransferReminderMessage({
    customerName: "粮油经营兰华鹏",
    assignedAtText: "2026/04/16 09:50:35",
    actionLabel: "转接",
    staffMentionText: "<@yebinghui>"
  });

  assert.equal(
    message,
    [
      "客户：粮油经营兰华鹏",
      "转接时间：2026/04/16 09:50:35",
      "<@yebinghui>，你有新的转接信息，记得及时回复。"
    ].join("\n")
  );
});

test("转接提醒应该优先命中企微 userid 行内@", () => {
  const plan = resolveTransferReminderMentionPlan(
    {
      staffName: "顾远"
    },
    {
      memberMobileMap: {
        顾远: "13800000000"
      },
      memberUserIdMap: {
        顾远: "yebinghui"
      },
      memberInlineMentionEnabledMap: {
        顾远: true
      }
    }
  );

  assert.equal(plan.staffMentionText, "<@yebinghui>");
  assert.deepEqual(plan.mentionedMobileList, []);
});

test("缺少 userid 时应该回落到底部手机号@", () => {
  const plan = resolveTransferReminderMentionPlan(
    {
      staffName: "顾远"
    },
    {
      memberMobileMap: {
        顾远: "13800000000"
      },
      memberUserIdMap: {},
      memberInlineMentionEnabledMap: {}
    }
  );

  assert.equal(plan.staffMentionText, "顾远");
  assert.deepEqual(plan.mentionedMobileList, ["13800000000"]);
});

test("成员既没有手机号也没有 userid 时应该直接报错", () => {
  assert.throws(
    () =>
      resolveTransferReminderMentionPlan(
        {
          staffName: "顾远"
        },
        {
          memberMobileMap: {},
          memberUserIdMap: {},
          memberInlineMentionEnabledMap: {}
        }
      ),
    /未配置手机号或 userid/
  );
});
