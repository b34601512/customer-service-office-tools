const { loadWecomRobotConfig } = require("../../config/wecomRobotConfigLoader");
const { log } = require("../../engine/logger");
const { sendWecomRobotTextMessage } = require("../../integrations/wecomRobot");
const { resolveMentionPlan } = require("../../integrations/wecomTextMention");

function resolveNotificationTargets(config) {
  // 这里统一把下班提醒的通知群收口成可发送目标，优先沿用控制台里启用中的通知群。
  const configuredTargets = (Array.isArray(config.notificationGroups) ? config.notificationGroups : [])
    .filter((group) => group && group.enabled)
    .map((group) => ({
      webhookName: String(group.name || "未命名通知群").trim() || "未命名通知群",
      webhookUrl: String(group.webhookUrl || "").trim()
    }));
  if (configuredTargets.length > 0) {
    return configuredTargets;
  }

  const legacyTargets = [
    { webhookName: "售前群", webhookUrl: String(config.preSalesWebhookUrl || "").trim() },
    { webhookName: "售后群", webhookUrl: String(config.afterSalesWebhookUrl || "").trim() }
  ].filter((target) => target.webhookUrl);

  const mergedTargetMap = new Map();
  for (const target of legacyTargets) {
    if (!mergedTargetMap.has(target.webhookUrl)) {
      mergedTargetMap.set(target.webhookUrl, target);
    }
  }

  return Array.from(mergedTargetMap.values());
}

function resolveNotificationMentionPlan(staffNames, config) {
  // 这里统一优先走企微 userid 行内 @，缺失 userid 时再回落到底部手机号 @。
  const mentionPlan = resolveMentionPlan(staffNames, {
    memberMobileMap: config.memberMobileMap,
    memberUserIdMap: config.memberUserIdMap,
    memberInlineMentionEnabledMap: config.memberInlineMentionEnabledMap
  });

  for (const staffName of Array.isArray(staffNames) ? staffNames : []) {
    const normalizedStaffName = String(staffName || "").trim();
    if (!normalizedStaffName) {
      continue;
    }

    if (mentionPlan.inlineMentionTokenMap[normalizedStaffName]) {
      log("主线:执行", "下班通知", "行内@", `客服=${normalizedStaffName}，已切换为企微 userid 行内艾特`);
      continue;
    }

    const mobile = String(config.memberMobileMap?.[normalizedStaffName] || "").trim();
    if (!mobile) {
      log("主线:执行", "下班通知", "缺少@映射", `客服=${normalizedStaffName}，当前未配置企微手机号或 userid，本轮只发普通文本`);
    }
  }

  return mentionPlan;
}

async function sendOffDutyNotification(input) {
  // 这里统一发送下班相关企微消息，真正的消息内容由上层场景决定。
  const config = loadWecomRobotConfig();
  const targets = resolveNotificationTargets(config);
  if (targets.length === 0) {
    throw new Error("企微机器人配置缺失：当前没有启用的通知群，无法发送下班通知。");
  }

  const mentionPlan = resolveNotificationMentionPlan(input.mentionedStaffNames, config);
  const content =
    typeof input.buildContent === "function"
      ? input.buildContent({
          mentionPlan,
          config
        })
      : input.content;
  for (const target of targets) {
    if (!target.webhookUrl) {
      throw new Error(`企微机器人配置缺失：${target.webhookName} webhook 未填写。`);
    }

    await sendWecomRobotTextMessage({
      scene: input.scene,
      webhookName: target.webhookName,
      webhookUrl: target.webhookUrl,
      mentionedMobileList: mentionPlan.mentionedMobileList,
      content
    });
  }

  return {
    mentionedMobileList: mentionPlan.mentionedMobileList,
    webhookName: targets.map((target) => target.webhookName).join(" + "),
    mentionPlan
  };
}

function buildOffDutyClosedMessage(input) {
  // 这里把下班已处理通知压成最短执行文案，群里只保留“谁、做了什么、明天什么班”。
  const lines = [
    `${input.staffMentionText || input.staffName}，已帮你处理下班收尾。`,
    `${input.actionSummary}。`
  ];

  if (input.tomorrowShiftNotificationEnabled) {
    lines.push(`明天班次：${input.tomorrowShiftLabel}`);
  }

  lines.push("安心下班。");
  return lines.join("\n");
}

module.exports = {
  buildOffDutyClosedMessage,
  sendOffDutyNotification
};
