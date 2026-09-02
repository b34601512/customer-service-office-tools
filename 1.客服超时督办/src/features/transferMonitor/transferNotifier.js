const { loadWecomRobotConfig } = require("../../config/wecomRobotConfigLoader");
const { log } = require("../../engine/logger");
const { sendWecomRobotTextMessage } = require("../../integrations/wecomRobot");
const { resolveMentionPlan } = require("../../integrations/wecomTextMention");
const { resolveEscalationTargets } = require("../timeoutSoothe/timeoutEscalation");

function buildTransferReminderMessage(input) {
  // 这里把转接提醒压成最短可执行文案，让群里只看到“谁、发生了什么、要马上做什么”。
  const lines = [`客户：${input.customerName}`];
  if (input.assignedAtText) {
    lines.push(`${input.actionLabel}时间：${input.assignedAtText}`);
  }

  lines.push(
    input.staffMentionText
      ? `${input.staffMentionText}，你有新的${input.actionLabel}信息，记得及时回复。`
      : `你有新的${input.actionLabel}信息，记得及时回复。`
  );
  return lines.join("\n");
}

function resolveTransferReminderMentionPlan(assigneeMember, config) {
  // 这里统一决定被转接客服走行内@还是底部手机号@，缺映射时直接抛错暴露配置问题。
  const staffName = String(assigneeMember?.staffName || "").trim();
  if (!staffName) {
    throw new Error("转接提醒失败：未识别到被转接客服姓名。");
  }

  const mentionPlan = resolveMentionPlan([staffName], {
    memberMobileMap: config.memberMobileMap,
    memberUserIdMap: config.memberUserIdMap,
    memberInlineMentionEnabledMap: config.memberInlineMentionEnabledMap
  });
  const inlineMentionToken = mentionPlan.inlineMentionTokenMap[staffName] || "";
  const hasMobileMention = mentionPlan.mentionedMobileList.length > 0;
  if (!inlineMentionToken && !hasMobileMention) {
    throw new Error(`企微成员配置缺失：成员「${staffName}」未配置手机号或 userid，无法发送转接提醒。`);
  }

  log(
    "主线:执行",
    "转接提醒",
    inlineMentionToken ? "命中行内@" : "命中底部@",
    `客服=${staffName}，本轮改用${inlineMentionToken ? "企微 userid 行内艾特" : "企微手机号底部艾特"}`
  );
  return {
    ...mentionPlan,
    staffMentionText: inlineMentionToken || staffName
  };
}

async function sendTransferReminder(input) {
  // 这里统一给被分配客服发送群提醒，真正的群路由和 @ 逻辑都收口到这里。
  const config = loadWecomRobotConfig();
  const assigneeMember = input.assigneeMember || {};
  const routingGroup = ["pre_sales", "after_sales", "management"].includes(assigneeMember.staffGroup)
    ? assigneeMember.staffGroup
    : "management";
  const targets = resolveEscalationTargets(
    {
      staffGroup: assigneeMember.staffGroup,
      routingGroup
    },
    config
  );
  if (targets.length === 0) {
    throw new Error("企微机器人配置缺失：当前没有启用的通知群，无法发送转接提醒。");
  }

  const mentionPlan = resolveTransferReminderMentionPlan(assigneeMember, config);
  for (const target of targets) {
    if (!target.webhookUrl) {
      throw new Error(`企微机器人配置缺失：${target.webhookName} webhook 未填写。`);
    }

    await sendWecomRobotTextMessage({
      scene: "转接提醒",
      webhookName: target.webhookName,
      webhookUrl: target.webhookUrl,
      mentionedMobileList: mentionPlan.mentionedMobileList,
      content: buildTransferReminderMessage({
        customerName: input.customerName,
        assignedAtText: input.assignedAtText,
        actionLabel: input.actionLabel,
        staffMentionText: mentionPlan.staffMentionText
      })
    });
  }

  return {
    mentionPlan,
    webhookName: targets.map((target) => target.webhookName).join(" + ")
  };
}

module.exports = {
  buildTransferReminderMessage,
  resolveTransferReminderMentionPlan,
  sendTransferReminder
};
