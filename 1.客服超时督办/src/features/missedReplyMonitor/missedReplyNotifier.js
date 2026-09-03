const { loadWecomRobotConfig } = require("../../config/wecomRobotConfigLoader");
const { log } = require("../../engine/logger");
const { sendWecomRobotTextMessage } = require("../../integrations/wecomRobot");
const { resolveMentionPlan } = require("../../integrations/wecomTextMention");
const { resolveEscalationTargets } = require("../timeoutSoothe/timeoutEscalation");
const {
  ASSIGNMENT_STATUS,
  normalizeAssignmentStatus
} = require("../shared/currentAssignment");
const MANAGER_STAFF_NAME = "黎路遥";

function formatDurationText(seconds) {
  // 这里把秒数压成客服一眼能看懂的等待时长，群里不展示多余小数。
  const normalizedSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  if (normalizedSeconds >= 3600) {
    const hours = Math.floor(normalizedSeconds / 3600);
    const minutes = Math.floor((normalizedSeconds % 3600) / 60);
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
  }

  if (normalizedSeconds >= 60) {
    return `${Math.floor(normalizedSeconds / 60)}分钟`;
  }

  return `${normalizedSeconds}秒`;
}

function resolveReminderText(reminderKind) {
  // 这里统一把提醒类型压成用户能直接理解的短标签。
  return reminderKind === "timeout" ? "超时" : "漏回复";
}

function resolveActionText(reminderKind) {
  // 这里让短阈值提醒更像催处理，长阈值提醒更像防遗漏。
  return reminderKind === "timeout" ? "请尽快处理。" : "请补充实质回复。";
}

function resolveAssigneeActionLine(input) {
  // 未分配是平台业务状态，成员映射缺失才是配置错误，两者不能再混称“未识别”。
  const assignmentStatus = normalizeAssignmentStatus(input?.assignmentStatus, {
    assignedToUserId: input?.assignedToUserId,
    assigneeName: input?.staffMentionText
  });
  if (assignmentStatus === ASSIGNMENT_STATUS.UNASSIGNED) {
    return "当前会话未分配客服，已提醒主管认领。";
  }
  if (assignmentStatus === ASSIGNMENT_STATUS.MEMBER_MAPPING_MISSING) {
    const assignedToUserId = String(input?.assignedToUserId || "").trim();
    const idText = assignedToUserId ? `（${assignedToUserId}）` : "";
    return `当前接待ID${idText}缺少成员映射，已提醒主管处理。`;
  }

  const staffMentionText = String(input?.staffMentionText || "").trim();
  if (!staffMentionText) {
    throw new Error("未实质回复提醒状态错误：已分配客服却缺少成员姓名。");
  }

  if (assignmentStatus === ASSIGNMENT_STATUS.LAST_HANDLER) {
    // 会话已结束但客户仍未被实质回复：责任兜底给最后接待客服，不再让主管凭空认领。
    return `${staffMentionText}，会话已结束客户仍未处理，${resolveActionText(input?.reminderKind)}`;
  }

  return `${staffMentionText}，${resolveActionText(input?.reminderKind)}`;
}

function buildUnresolvedReplyReminderMessage(input) {
  // 这里把未实质回复提醒压成最少必要信息，避免通知群被重复客户原文刷屏。
  const managerMentionText = String(input.managerMentionText || "").trim();
  const reminderKind = input.reminderKind === "timeout" ? "timeout" : "missedReply";
  const reminderText = resolveReminderText(reminderKind);
  const lines = [
    `客户：${input.customerName}`,
    `${reminderText}${formatDurationText(input.pendingDurationSeconds)}。`,
    resolveAssigneeActionLine({
      assignmentStatus: input.assignmentStatus,
      assignedToUserId: input.assignedToUserId,
      staffMentionText: input.staffMentionText,
      reminderKind
    })
  ];
  if (input.reasonLabel) {
    lines.push(`原因：${input.reasonLabel}`);
  }

  return [managerMentionText, ...lines].filter(Boolean).join("\n");
}

function resolveMissedReplyMentionPlan(assigneeMember, config) {
  // 当前接待最多一人；未分配或映射缺失时只 @ 主管，不再拼接历史处理人。
  const staffName = String(assigneeMember?.staffName || "").trim();
  const managerIsResponsible = staffName === MANAGER_STAFF_NAME;
  const mentionTargetStaffNames = Array.from(new Set([staffName, MANAGER_STAFF_NAME].filter(Boolean)));
  const mentionPlan = resolveMentionPlan(mentionTargetStaffNames, {
    memberMobileMap: config.memberMobileMap,
    memberUserIdMap: config.memberUserIdMap,
    memberInlineMentionEnabledMap: config.memberInlineMentionEnabledMap
  });
  const managerInlineMentionText = mentionPlan.inlineMentionTokenMap[MANAGER_STAFF_NAME] || "";
  const managerMentionText = managerIsResponsible
    ? ""
    : managerInlineMentionText;
  const managerMobile = String(config.memberMobileMap?.[MANAGER_STAFF_NAME] || "").trim();
  if (!managerInlineMentionText && !managerMobile) {
    throw new Error(`企微成员配置缺失：成员「${MANAGER_STAFF_NAME}」未配置手机号或 userid，无法发送未实质回复提醒。`);
  }

  if (staffName) {
    const inlineToken = mentionPlan.inlineMentionTokenMap[staffName];
    const mobile = String(config.memberMobileMap?.[staffName] || "").trim();
    if (!inlineToken && !mobile) {
      log("主线:执行", "未实质回复监控", "缺少@映射", `客服=${staffName}，既无企微userid也无手机号，本轮只能正文点名并@主管`);
    } else if (!inlineToken) {
      log("主线:执行", "未实质回复监控", "手机号@", `客服=${staffName}，未配置企微userid，改用底部手机号@（需该手机号已在通知群内才会生效）`);
    }
  }

  return {
    ...mentionPlan,
    staffName,
    staffMentionText: staffName ? mentionPlan.inlineMentionTokenMap[staffName] || staffName : "",
    managerMentionText
  };
}

function resolveMissedReplyTargets(assigneeMember, config) {
  // 有当前接待时按其组路由；未分配或映射缺失时进入管理路由。
  const staffGroup = String(assigneeMember?.staffGroup || "").trim();
  const routingGroup = ["pre_sales", "after_sales", "management"].includes(staffGroup)
    ? staffGroup
    : "management";
  const targets = resolveEscalationTargets(
    {
      staffGroup,
      routingGroup
    },
    config
  );
  if (targets.length === 0) {
    throw new Error("企微机器人配置缺失：当前没有启用的通知群，无法发送未实质回复提醒。");
  }

  return targets;
}

async function sendUnresolvedReplyReminder(input) {
  // 这里统一发送未实质回复提醒，工作流只负责判断和状态推进。
  const config = loadWecomRobotConfig();
  const targets = resolveMissedReplyTargets(input.assigneeMember, config);
  const mentionPlan = resolveMissedReplyMentionPlan(input.assigneeMember, config);
  const reminderKind = input.reminderKind === "timeout" ? "timeout" : "missedReply";
  const content = buildUnresolvedReplyReminderMessage({
    reminderKind,
    customerName: input.customerName,
    pendingDurationSeconds: input.pendingDurationSeconds,
    reasonLabel: input.reasonLabel,
    assignmentStatus: input.assignmentStatus,
    assignedToUserId: input.assignedToUserId,
    staffMentionText: mentionPlan.staffMentionText,
    managerMentionText: mentionPlan.managerMentionText
  });

  for (const target of targets) {
    if (!target.webhookUrl) {
      throw new Error(`企微机器人配置缺失：${target.webhookName} webhook 未填写。`);
    }

    await sendWecomRobotTextMessage({
      scene: reminderKind === "timeout" ? "超时提醒" : "漏回复提醒",
      webhookName: target.webhookName,
      webhookUrl: target.webhookUrl,
      mentionedMobileList: mentionPlan.mentionedMobileList,
      content
    });
  }

  return {
    mentionPlan,
    webhookName: targets.map((target) => target.webhookName).join(" + ")
  };
}

module.exports = {
  MANAGER_STAFF_NAME,
  buildUnresolvedReplyReminderMessage,
  formatDurationText,
  resolveAssigneeActionLine,
  resolveMissedReplyMentionPlan,
  resolveMissedReplyTargets,
  sendUnresolvedReplyReminder
};
