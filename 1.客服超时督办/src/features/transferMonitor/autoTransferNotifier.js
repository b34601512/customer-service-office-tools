// 该文件只负责把超时自动转接的结果发到企微群：成功后留痕，失败必须@主管，避免转接无声无息。
const { log, logError } = require("../../engine/logger");
const { loadWecomRobotConfig } = require("../../config/wecomRobotConfigLoader");
const { resolveManagerStaffName } = require("../../config/managerStaffName");
const { sendWecomRobotTextMessage } = require("../../integrations/wecomRobot");
const { resolveEscalationTargets } = require("../timeoutSoothe/timeoutEscalation");

const AUTO_TRANSFER_LOG_MODULE_NAME = "超时自动转接";

const FAILURE_REASON_LABELS = Object.freeze({
  no_on_shift_member: "当时这个组没有当班的客服（排班表上都不是早/晚班）",
  on_shift_member_offline: "当班的客服都没上线（没开接单开关）",
  assignment_unchanged: "已发出转接指令，但平台分配结果没有变化",
  assignment_still_empty: "已发出转接指令，但平台仍显示未分配",
  chat_not_found_in_snapshot: "已发出转接指令，但在联系人快照里找不到该客户",
  socket_send_failed: "页面 socket 发送失败",
  no_open_app_socket: "页面没有可用的 socket 连接",
  requested_socket_not_open: "页面 socket 连接已断开",
  assign_request_failed: "转接指令发送异常"
});

function resolveFailureReasonText(reason) {
  const normalizedReason = String(reason || "").trim();
  return FAILURE_REASON_LABELS[normalizedReason] || (normalizedReason || "未知原因");
}

function resolveReminderKindText(reminderKind) {
  // 提醒类型只用于通知文案，和主链路的中文口径保持一致。
  return String(reminderKind || "").trim() === "missedReply" ? "漏回复提醒" : "首次超时提醒";
}

function buildAutoTransferSuccessMessage(input) {
  return [
    "【超时自动转接】客户已改派",
    `客户：${input.customerName || "未命名客户"}`,
    `原接待：${input.sourceStaffName || "未知"}（当时不在自己班次内）`,
    `已转给：${input.targetStaffName || "未知"}（当班且已上线）`,
    `触发：${input.reminderKindLabel || "超时提醒"}`
  ].join("\n");
}

function buildAutoTransferFailureMessage(input) {
  return [
    "【超时自动转接失败】请主管介入",
    `客户：${input.customerName || "未命名客户"}`,
    `原接待：${input.sourceStaffName || "未知"}（当时不在自己班次内）`,
    `触发：${input.reminderKindLabel || "超时提醒"}`,
    `原因：${resolveFailureReasonText(input.reason)}`
  ].join("\n");
}

function resolveManagerMentionMobile(config) {
  // 失败通知必须@主管，缺手机号时直接在正文说明，不让提醒静默降级。
  const managerName = resolveManagerStaffName();
  const managerMobile = String(config.memberMobileMap?.[managerName] || "").trim();
  if (!managerMobile) {
    log(
      "主线:执行",
      AUTO_TRANSFER_LOG_MODULE_NAME,
      "缺少@映射",
      `主管=${managerName}，未配置企微手机号，失败通知只能正文点名`
    );
  }
  return managerMobile;
}

async function sendAutoTransferNotice(input = {}) {
  // outcome=succeeded 只留痕；outcome=failed 额外@主管，符合“失败必须让我知道”的口径。
  const outcome = input.outcome === "succeeded" ? "succeeded" : "failed";
  const config = loadWecomRobotConfig();
  const targets = resolveEscalationTargets(
    {
      staffGroup: "management",
      routingGroup: "management"
    },
    config
  );
  if (targets.length === 0) {
    throw new Error("企微机器人配置缺失：当前没有启用的通知群，无法发送超时自动转接结果。");
  }

  const content = outcome === "succeeded"
    ? buildAutoTransferSuccessMessage(input)
    : buildAutoTransferFailureMessage(input);
  const mentionedMobileList = outcome === "failed"
    ? [resolveManagerMentionMobile(config)].filter(Boolean)
    : [];

  for (const target of targets) {
    if (!target.webhookUrl) {
      throw new Error(`企微机器人配置缺失：${target.webhookName} webhook 未填写。`);
    }

    await sendWecomRobotTextMessage({
      scene: outcome === "succeeded" ? "自动转接成功" : "自动转接失败",
      webhookName: target.webhookName,
      webhookUrl: target.webhookUrl,
      mentionedMobileList,
      content
    });
  }

  log(
    "主线:完成",
    AUTO_TRANSFER_LOG_MODULE_NAME,
    outcome === "succeeded" ? "发送转接成功通知" : "发送转接失败通知",
    `客户=${input.customerName || "未命名客户"}，目标=${input.targetStaffName || "无"}，群=${targets.map((target) => target.webhookName).join(" + ")}`
  );

  return {
    outcome,
    webhookName: targets.map((target) => target.webhookName).join(" + "),
    mentionedMobileCount: mentionedMobileList.length
  };
}

async function sendAutoTransferNoticeSafely(input = {}) {
  // 通知失败不能反过来吞掉转接主流程，只打印根因。
  try {
    return await sendAutoTransferNotice(input);
  } catch (error) {
    logError("主线:失败", AUTO_TRANSFER_LOG_MODULE_NAME, "发送转接结果通知", error);
    return { outcome: "notify_failed", error };
  }
}

module.exports = {
  AUTO_TRANSFER_LOG_MODULE_NAME,
  FAILURE_REASON_LABELS,
  buildAutoTransferFailureMessage,
  buildAutoTransferSuccessMessage,
  resolveFailureReasonText,
  resolveReminderKindText,
  sendAutoTransferNotice,
  sendAutoTransferNoticeSafely
};
