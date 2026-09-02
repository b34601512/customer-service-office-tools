// 该文件用于执行单轮未实质回复扫描，上层循环只负责调度下一轮。
const { loadReplyConfig } = require('../../../config/replyConfigLoader');
const { log, logError } = require('../../../engine/logger');
const {
  TRANSFER_MONITOR_CONTACTS_PAGE_SIZE,
  fetchTransferMonitorSnapshot
} = require('../../transferMonitor/transferApiClient');
const {
  clearResolvedMissedReplyState,
  clearUnresolvedReplyCountdownItem,
  setUnresolvedReplyDecisionItem
} = require('../missedReplyStateStore');
const { attachContactListIndexes, selectContactsForMissedReplyScan } = require('./contactScan');
const { analyzeContactMissedReply } = require('./contactAnalyzer');
const { buildUnifiedDecisionItem } = require('./decisionPresenter');
const { updateCountdownSnapshot } = require('./countdownSnapshot');
const { processReminderCandidate } = require('./reminderProcessor');
const { persistMissedReplyRuntimeState } = require('./runtimeState');
const {
  clearExplicitlyExcludedContacts,
  mergeRetainedPendingContacts,
  pruneMissingResolvedDecisionItems
} = require('./contactRetention');
const { incrementDecisionReasonCount, logMissedReplySummary } = require('./summaryLogger');
const {
  buildScanSummary,
  incrementReminderCandidateSummary,
  incrementReminderSentSummary
} = require('./scanSummary');
const { MISSED_REPLY_LOG_MODULE_NAME } = require('./constants');
const { recordTimeoutResolution } = require('../../timeoutPerformance/timeoutPerformanceLedger');

function selectContactsFromSharedSnapshot(snapshot) {
  // 未回复业务消费接口当前可返回的完整快照；每轮消息请求数量由批次配置单独控制。
  return Array.isArray(snapshot?.contacts) ? snapshot.contacts : [];
}

async function runMissedReplyMonitorScanWithSnapshot(page, runtimeState, snapshot) {
  // 这里执行单轮统一未回复扫描：消费共享联系人快照，只对本轮候选读取消息。
  const replyConfig = loadReplyConfig();
  if (!replyConfig.missedReplyMonitorEnabled) {
    if (!runtimeState.disabledLogged) {
      runtimeState.disabledLogged = true;
      log("主线:停止", MISSED_REPLY_LOG_MODULE_NAME, "配置停用", "未实质回复监控已在配置中关闭");
    }
    runtimeState.countdownItemsByChatId = {};
    runtimeState.decisionItemsByChatId = {};
    persistMissedReplyRuntimeState(runtimeState);
    return;
  }
  runtimeState.disabledLogged = false;

  const mirroredContacts = attachContactListIndexes(selectContactsFromSharedSnapshot(snapshot));
  clearExplicitlyExcludedContacts(runtimeState, snapshot?.groupContacts);
  const monitoredContacts = mergeRetainedPendingContacts(
    runtimeState,
    mirroredContacts,
    snapshot?.groupContacts
  );
  pruneMissingResolvedDecisionItems(runtimeState, monitoredContacts);
  const contactsForScan = selectContactsForMissedReplyScan(
    runtimeState,
    monitoredContacts,
    replyConfig.missedReplyMaxContactsPerScan
  );
  const summary = buildScanSummary(monitoredContacts.length, contactsForScan.length);

  for (const contact of contactsForScan) {
    try {
      const scanNowMs = Date.now();
      const { unresolvedState, reminderDecision } = await analyzeContactMissedReply(
        page,
        contact,
        replyConfig,
        snapshot.memberMapByUserId
      );
      incrementDecisionReasonCount(summary, unresolvedState);
      setUnresolvedReplyDecisionItem(
        runtimeState,
        buildUnifiedDecisionItem({
          unresolvedState,
          reminderDecision,
          contact,
          runtimeState,
          nowMs: scanNowMs
        })
      );

      if (!unresolvedState.isPendingUnresolvedReplyCandidate) {
        recordTimeoutResolution({
          chatId: contact.chatId,
          resolvedAtMs: unresolvedState.substantiveReplyAtMs
        });
        if (clearResolvedMissedReplyState(runtimeState, contact.chatId)) {
          summary.resolvedCount += 1;
        }
        clearUnresolvedReplyCountdownItem(runtimeState, contact.chatId);
        continue;
      }

      if (reminderDecision.shouldRemind) {
        incrementReminderCandidateSummary(summary, reminderDecision);
        const sent = await processReminderCandidate(runtimeState, reminderDecision, snapshot.memberMapByUserId);
        if (sent) {
          incrementReminderSentSummary(summary, reminderDecision);
        } else {
          summary.suppressedCount += 1;
        }
      }

      updateCountdownSnapshot(runtimeState, reminderDecision, scanNowMs);
    } catch (error) {
      logError(
        "主线:失败",
        MISSED_REPLY_LOG_MODULE_NAME,
        `单个会话扫描失败(${contact.customerName || contact.chatId})`,
        error
      );
    }
  }

  persistMissedReplyRuntimeState(runtimeState);
  logMissedReplySummary(runtimeState, summary);
}

async function runMissedReplyMonitorScan(page, runtimeState) {
  // 这里保留单轮扫描入口给测试和临时排障使用，正式后台运行走共享聊天采集器。
  const replyConfig = loadReplyConfig();
  const snapshot = await fetchTransferMonitorSnapshot(page, {
    logModuleName: MISSED_REPLY_LOG_MODULE_NAME,
    contactPageSize: TRANSFER_MONITOR_CONTACTS_PAGE_SIZE
  });
  await runMissedReplyMonitorScanWithSnapshot(page, runtimeState, snapshot);
}

module.exports = {
  runMissedReplyMonitorScan,
  runMissedReplyMonitorScanWithSnapshot,
  selectContactsFromSharedSnapshot
};
