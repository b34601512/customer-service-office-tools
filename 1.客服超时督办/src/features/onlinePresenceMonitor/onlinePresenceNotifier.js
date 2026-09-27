const { loadWecomRobotConfig } = require("../../config/wecomRobotConfigLoader");
const { log } = require("../../engine/logger");
const { sendWecomRobotTextMessage } = require("../../integrations/wecomRobot");
const { resolveMentionPlan } = require("../../integrations/wecomTextMention");
const { resolveEscalationTargets } = require("../timeoutSoothe/timeoutEscalation");

const { resolveManagerStaffName } = require("../../config/managerStaffName");

const PRESENCE_GROUP_ORDER = ["pre_sales", "after_sales"];
const PRESENCE_GROUP_LABELS = Object.freeze({
  pre_sales: "售前",
  after_sales: "售后"
});
// 售前看「是否可被转接」、售后看「自动分配」，文案必须分组说清各自要开的开关。
const PRESENCE_GROUP_SWITCH_LABELS = Object.freeze({
  pre_sales: "是否可被转接",
  after_sales: "自动分配"
});

function resolveStaffMentionText(staffName, mentionTextByStaffName) {
  // 这里统一取某人的行内@文本，缺映射时退化成姓名，正文仍能点名。
  return mentionTextByStaffName?.[staffName] || staffName;
}

function buildGroupedDutyLines(input) {
  // 这里按售前/售后分组列人：不同组在线口径不同，不能再用一句统一的“没有人开启自动分配”。
  const expectedStaffNames = Array.isArray(input.expectedStaffNames) ? input.expectedStaffNames : [];
  const staffGroupByExpectedName = input.staffGroupByExpectedName || {};
  const mentionTextByStaffName = input.mentionTextByStaffName || {};
  const lines = [];

  for (const staffGroup of PRESENCE_GROUP_ORDER) {
    const staffNames = expectedStaffNames.filter(
      (staffName) => (staffGroupByExpectedName[staffName] || "") === staffGroup
    );
    if (staffNames.length === 0) {
      continue;
    }
    const nameText = staffNames
      .map((staffName) => resolveStaffMentionText(staffName, mentionTextByStaffName))
      .join(" / ");
    lines.push(
      `· ${PRESENCE_GROUP_LABELS[staffGroup]}（${nameText}）：开启「${PRESENCE_GROUP_SWITCH_LABELS[staffGroup]}」`
    );
  }

  if (lines.length === 0 && expectedStaffNames.length > 0) {
    // 分组信息缺失时保底点名，避免文案漏人。
    const nameText = expectedStaffNames
      .map((staffName) => resolveStaffMentionText(staffName, mentionTextByStaffName))
      .join(" / ");
    lines.push(`· ${nameText}：请开启接单开关`);
  }

  return lines;
}

function buildOnlinePresenceReminderMessage(input) {
  // 这里把未上线提醒压成最少必要信息：谁该上线、各自开哪个开关、主管请督办。
  const expectedStaffNames = Array.isArray(input.expectedStaffNames) ? input.expectedStaffNames : [];
  const mentionTextByStaffName = input.mentionTextByStaffName || {};
  const managerStaffName = String(input.managerStaffName || "").trim();
  const managerLine =
    managerStaffName && !expectedStaffNames.includes(managerStaffName)
      ? `${resolveStaffMentionText(managerStaffName, mentionTextByStaffName)}（主管）请督办`
      : "";

  return [
    "应值班客服尚未上线，请尽快处理：",
    ...buildGroupedDutyLines({
      expectedStaffNames,
      staffGroupByExpectedName: input.staffGroupByExpectedName,
      mentionTextByStaffName
    }),
    managerLine
  ]
    .filter(Boolean)
    .join("\n");
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
  const expectedStaffNames = Array.isArray(input.expectedStaffNames)
    ? input.expectedStaffNames.filter(Boolean)
    : [];
  const managerStaffName = resolveManagerStaffName();
  const targetStaffNames = Array.from(new Set([managerStaffName, ...expectedStaffNames].filter(Boolean)));
  const mentionPlan = resolveOnlinePresenceMentionPlan(targetStaffNames, config);
  const mentionTextByStaffName = {};
  for (const staffName of targetStaffNames) {
    mentionTextByStaffName[staffName] = resolveStaffMentionText(staffName, mentionPlan.inlineMentionTokenMap);
  }
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
    expectedStaffNames,
    staffGroupByExpectedName: input.staffGroupByExpectedName || {},
    mentionTextByStaffName,
    managerStaffName
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
  buildOnlinePresenceReminderMessage,
  sendOnlinePresenceReminder
};
