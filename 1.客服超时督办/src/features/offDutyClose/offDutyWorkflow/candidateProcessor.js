// 该文件用于处理单个客服的下班收尾动作。
const { log } = require("../../../engine/logger");
const { buildOffDutyCompletionNoticeKey } = require("../offDutyPolicy");
const { readMemberRow } = require("../memberSettingsPage");
const { buildActionSummary } = require("./actionSummary");
const { notifyCompletedClose } = require("./completionNotifier");
const { disableMemberForOffDuty } = require("./memberDisabler");
const { buildSilentCompletionReason, isMemberAlreadyClosed } = require("./memberClosedState");
const { recordOffDutyProcess } = require("./processRecorder");

async function processCandidate(page, candidate, config, stateStore) {
  // 这里统一执行单个客服的下班收尾，确保每个人都按同一顺序处理。
  const existingCompletion = stateStore.getActionCompletion(candidate.actionKey);
  const currentRow = await readMemberRow(page, candidate.staffName);
  if (isMemberAlreadyClosed(currentRow)) {
    if (!existingCompletion) {
      stateStore.markActionCompleted(candidate.actionKey, {
        reason: "状态同步"
      });
      log("主线:完成", "下班监控", "同步状态", buildSilentCompletionReason(candidate));
    }
    return;
  }

  if (existingCompletion) {
    stateStore.clearActionCompleted(candidate.actionKey);
    log(
      "主线:执行",
      "下班监控",
      "检测到重新开启",
      `客服=${candidate.staffName} 原已记录完成，但当前又出现开启态，本轮重新执行收尾`
    );
  }

  const disabledResult = await disableMemberForOffDuty(page, candidate);
  const actions = disabledResult.actions.slice();
  const workingRow = disabledResult.row;

  if (candidate.silentClose) {
    // 这里上班时间未到就关闭开关属于静默动作，只落记录和状态，不发企微“下班收尾”提醒，避免误导。
    const silentReason = `客服=${candidate.staffName} 不在上班时间窗内（${candidate.startTimeText} 前未到岗），已静默关闭：${buildActionSummary(actions)}`;
    stateStore.markActionCompleted(candidate.actionKey, {
      reason: silentReason
    });
    recordOffDutyProcess(candidate, "已静默关闭上班前配置", silentReason, {
      dispatchAction: "off_duty_silent_close",
      dispatchTarget: candidate.staffName
    });
    log("主线:完成", "下班监控", "静默关闭", silentReason);
    return;
  }

  if (workingRow.currentConversationCount > 0) {
    log(
      "主线:执行",
      "下班监控",
      "保留待人工确认",
      `客服=${candidate.staffName} 仍有 ${workingRow.currentConversationCount} 个会话，本轮只关闭开关，不自动释放对话（可能仍在收尾）`
    );
    return;
  }

  const actionSummary = buildActionSummary(actions);
  const reason = `客服=${candidate.staffName} 已完成下班收尾：${actionSummary}。明天班次=${candidate.tomorrowShiftLabel}`;
  const completionNoticeKey = buildOffDutyCompletionNoticeKey(candidate.closeAt, candidate.staffName);

  if (stateStore.hasCompletionNotice(completionNoticeKey)) {
    stateStore.markActionCompleted(candidate.actionKey, {
      reason
    });
    log(
      "主线:完成",
      "下班监控",
      "今日完成通知已发送",
      `客服=${candidate.staffName}，今天已经发过下班收尾通知，本轮仅同步状态`
    );
    return;
  }

  const completionNotice = await notifyCompletedClose(candidate, config, actionSummary);
  stateStore.markCompletionNoticeSent(completionNoticeKey, {
    reason,
    actionSummary
  });
  recordOffDutyProcess(candidate, "已自动关闭下班配置", reason, {
    escalationStatus: completionNotice.escalationStatus,
    escalationWebhookName: completionNotice.escalationWebhookName,
    dispatchAction: "off_duty_close",
    dispatchTarget: candidate.staffName
  });
  stateStore.markActionCompleted(candidate.actionKey, {
    reason
  });
  log("主线:完成", "下班监控", "处理完成", reason);
}

module.exports = {
  processCandidate
};
