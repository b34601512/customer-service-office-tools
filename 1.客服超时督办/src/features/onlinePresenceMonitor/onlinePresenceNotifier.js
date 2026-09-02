const { loadWecomRobotConfig } = require("../../config/wecomRobotConfigLoader");
const { log } = require("../../engine/logger");
const { sendWecomRobotTextMessage } = require("../../integrations/wecomRobot");
const { resolveMentionPlan } = require("../../integrations/wecomTextMention");
const { resolveEscalationTargets } = require("../timeoutSoothe/timeoutEscalation");

const ONLINE_PRESENCE_MANAGER_NAME = "黎路遥";

function buildOnlinePresenceReminderMessage(input) {
  // 这里把无人在线提醒压成最少必要信息，只说谁需要上线和系统看到的名单。
  const targetMentionTexts = input.targetMentionTexts || input.targetStaffNames || [];
  return [
    `请 ${targetMentionTexts.join(" / ")} 尽快上线。`,
    "当前应值班客服没有人开启自动分配。",
    `应值班客服：${input.expectedStaffNames.join(" / ")}`
  ].join("\n");
}

function resolveOnlinePresenceMentionPlan(staffNames, config) {
  // 这里统一决定无人在线提醒的行内@和底部@，缺映射时正文仍保留姓名。
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
    if (mentionPlan.inlineMentionTokenMap[normalizedStaffName] || config.memberMobileMap?.[normalizedStaffName]) {
      continue;
    }
    log("主线:执行", "上班监控", "缺少@映射", `客服=${normalizedStaffName}，本轮只在正文点名`);
  }

  return mentionPlan;
}

async function sendOnlinePresenceReminder(input) {
  // 这里统一发送无人在线提醒，工作流只负责判断，不直接拼企微发送细节。
  const config = loadWecomRobotConfig();
  const targetStaffNames = Array.from(
    new Set([ONLINE_PRESENCE_MANAGER_NAME, ...(input.expectedStaffNames || [])].filter(Boolean))
  );
  const mentionPlan = resolveOnlinePresenceMentionPlan(targetStaffNames, config);
  const targets = resolveEscalationTargets(
    {
      staffGroup: "management",
      routingGroup: "management"
    },
    config
  );
  if (targets.length === 0) {
    throw new Error("企微机器人配置缺失：当前没有启用的通知群，无法发送上班监控提醒。");
  }

  const content = buildOnlinePresenceReminderMessage({
    expectedStaffNames: input.expectedStaffNames,
    targetStaffNames,
    targetMentionTexts: targetStaffNames.map((staffName) => mentionPlan.inlineMentionTokenMap[staffName] || staffName)
  });

  for (const target of targets) {
    if (!target.webhookUrl) {
      throw new Error(`企微机器人配置缺失：${target.webhookName} webhook 未填写。`);
    }
    await sendWecomRobotTextMessage({
      scene: "上班监控",
      webhookName: target.webhookName,
      webhookUrl: target.webhookUrl,
      mentionedMobileList: mentionPlan.mentionedMobileList,
      content
    });
  }

  return {
    targetStaffNames,
    webhookName: targets.map((target) => target.webhookName).join(" + ")
  };
}

module.exports = {
  ONLINE_PRESENCE_MANAGER_NAME,
  buildOnlinePresenceReminderMessage,
  sendOnlinePresenceReminder
};
