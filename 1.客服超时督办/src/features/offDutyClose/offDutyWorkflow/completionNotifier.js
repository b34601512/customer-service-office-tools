// 该文件用于发送下班收尾完成通知。
const {
  buildOffDutyClosedMessage,
  sendOffDutyNotification
} = require("../offDutyNotifier");

async function notifyCompletedClose(candidate, config, actionSummary) {
  // 这里统一给已完成收尾的客服发群提醒，默认不外发明天班次，只在后台记录。
  const notificationResult = await sendOffDutyNotification({
    scene: "下班自动关闭",
    mentionedStaffNames: [candidate.staffName],
    buildContent: ({ mentionPlan }) =>
      buildOffDutyClosedMessage({
        staffName: candidate.staffName,
        staffMentionText: mentionPlan.inlineMentionTokenMap[candidate.staffName] || candidate.staffName,
        actionSummary,
        tomorrowShiftLabel: candidate.tomorrowShiftLabel,
        tomorrowShiftNotificationEnabled: config.offDutyTomorrowShiftNotificationEnabled
      })
  });

  return {
    escalationStatus: notificationResult.mentionedMobileList.length > 0 ? "已发送下班提醒并精确@" : "已发送下班提醒，未精确@",
    escalationWebhookName: notificationResult.webhookName
  };
}

module.exports = {
  notifyCompletedClose
};
