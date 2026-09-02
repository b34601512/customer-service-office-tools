const { loadReplyConfig } = require("../../config/replyConfigLoader");
const { log, logError } = require("../../engine/logger");
const { clickLeftAllMenu } = require("../chatPage");
const { ensureLoginReadyForRun } = require("../loginFlow");
const {
  TRANSFER_MONITOR_CONTACTS_PAGE_SIZE,
  fetchTransferMonitorSnapshot
} = require("../transferMonitor/transferApiClient");
const {
  createTransferMonitorRuntimeState,
  runTransferMonitorScanWithSnapshot
} = require("../transferMonitor/transferMonitorWorkflow");
const { createMissedReplyMonitorRuntimeState } = require("../missedReplyMonitor/missedReplyWorkflow/runtimeState");
const { runMissedReplyMonitorScanWithSnapshot } = require("../missedReplyMonitor/missedReplyWorkflow/scanRunner");
const { recordActiveStaffSnapshot } = require("../timeoutPerformance/timeoutPerformanceLedger");

const CHAT_MONITOR_LOG_MODULE_NAME = "聊天监控";

function createChatMonitorRuntimeState(nowMs = 0) {
  // 这里集中保存聊天监控状态，避免转接和未回复各自管理页面轮询。
  return {
    transferRuntimeState: createTransferMonitorRuntimeState(),
    missedReplyRuntimeState: createMissedReplyMonitorRuntimeState(),
    nextTransferScanAtMs: nowMs,
    nextMissedReplyScanAtMs: nowMs
  };
}

function resolveDueChatMonitorTasks(runtimeState, replyConfig, nowMs) {
  // 这里只判断本轮该跑哪些规则，不做任何业务读取。
  return {
    transferDue: nowMs >= runtimeState.nextTransferScanAtMs,
    missedReplyDue: nowMs >= runtimeState.nextMissedReplyScanAtMs
  };
}

function resolveSharedSnapshotPageSize(replyConfig, dueTasks) {
  // 这里按本轮实际需要决定共享快照范围，避免未回复模块再单独拉一次联系人。
  const pageSizes = [];
  if (dueTasks.transferDue) {
    pageSizes.push(TRANSFER_MONITOR_CONTACTS_PAGE_SIZE);
  }
  if (dueTasks.missedReplyDue && replyConfig.missedReplyMonitorEnabled) {
    pageSizes.push(TRANSFER_MONITOR_CONTACTS_PAGE_SIZE);
  }
  return Math.max(1, ...pageSizes);
}

function resolveNextWaitMs(runtimeState, nowMs) {
  // 这里计算下一次最近任务时间，让共享循环空闲时不忙等。
  const nextAtMs = Math.min(runtimeState.nextTransferScanAtMs, runtimeState.nextMissedReplyScanAtMs);
  return Math.max(200, Math.min(1000, nextAtMs - nowMs));
}

function markChatMonitorTaskScheduled(runtimeState, replyConfig, dueTasks, nowMs) {
  // 这里在每轮尝试后推进下次扫描时间，避免单个失败导致热循环刷屏。
  if (dueTasks.transferDue) {
    runtimeState.nextTransferScanAtMs = nowMs + Math.max(300, Number(replyConfig.transferMonitorScanIntervalMs) || 1500);
  }
  if (dueTasks.missedReplyDue) {
    runtimeState.nextMissedReplyScanAtMs = nowMs + Math.max(1000, Number(replyConfig.missedReplyScanIntervalMs) || 5000);
  }
}

async function bootstrapSharedChatMonitorPage(page) {
  // 这里统一初始化共享聊天页，后续转接和未回复都只走接口读取。
  await ensureLoginReadyForRun(page);
  await clickLeftAllMenu(page);
  log("主线:完成", CHAT_MONITOR_LOG_MODULE_NAME, "初始化页面", "共享聊天页已就绪，转接和未实质回复共用同一份联系人快照");
}

async function readSharedChatMonitorSnapshot(page, replyConfig, dueTasks) {
  // 这里统一读取联系人和成员快照，业务规则只消费这一份结果。
  const contactPageSize = resolveSharedSnapshotPageSize(replyConfig, dueTasks);
  return fetchTransferMonitorSnapshot(page, {
    logModuleName: CHAT_MONITOR_LOG_MODULE_NAME,
    contactPageSize
  });
}

async function runTransferTaskIfDue(page, runtimeState, dueTasks, snapshot) {
  // 这里只调度转接规则，失败时不影响未实质回复规则。
  if (!dueTasks.transferDue) {
    return;
  }

  try {
    await runTransferMonitorScanWithSnapshot(page, runtimeState.transferRuntimeState, snapshot);
  } catch (error) {
    logError("主线:失败", "转接监控", "单轮扫描失败", error);
  }
}

async function runMissedReplyTaskIfDue(page, runtimeState, dueTasks, snapshot) {
  // 这里只调度未实质回复规则，失败时不影响转接规则。
  if (!dueTasks.missedReplyDue) {
    return;
  }

  try {
    await runMissedReplyMonitorScanWithSnapshot(page, runtimeState.missedReplyRuntimeState, snapshot);
  } catch (error) {
    logError("主线:失败", "未实质回复监控", "单轮扫描失败", error);
  }
}

async function runDueChatMonitorTasks(page, runtimeState, replyConfig, dueTasks) {
  // 这里完成一轮共享采集和规则分发，保证联系人数据只读一次。
  const needsSnapshot = dueTasks.transferDue || (dueTasks.missedReplyDue && replyConfig.missedReplyMonitorEnabled);
  const snapshot = needsSnapshot
    ? await readSharedChatMonitorSnapshot(page, replyConfig, dueTasks)
    : { contacts: [], memberMapByUserId: {} };

  if (needsSnapshot) {
    recordActiveStaffSnapshot(snapshot.contacts, snapshot.memberMapByUserId);
  }

  await runTransferTaskIfDue(page, runtimeState, dueTasks, snapshot);
  await runMissedReplyTaskIfDue(page, runtimeState, dueTasks, snapshot);
}

async function monitorSharedChatWorkflow(createChatPage, stopState) {
  // 这里运行聊天监控主循环，用一个页面同时服务转接和未实质回复。
  const runtimeState = createChatMonitorRuntimeState(Date.now());
  let chatPage = null;

  try {
    chatPage = await createChatPage();
    await bootstrapSharedChatMonitorPage(chatPage);

    while (!stopState.stopped) {
      const replyConfig = loadReplyConfig();
      const nowMs = Date.now();
      const dueTasks = resolveDueChatMonitorTasks(runtimeState, replyConfig, nowMs);
      if (!dueTasks.transferDue && !dueTasks.missedReplyDue) {
        await chatPage.waitForTimeout(resolveNextWaitMs(runtimeState, nowMs));
        continue;
      }

      try {
        await runDueChatMonitorTasks(chatPage, runtimeState, replyConfig, dueTasks);
      } catch (error) {
        logError("主线:失败", CHAT_MONITOR_LOG_MODULE_NAME, "共享快照读取失败", error);
      } finally {
        markChatMonitorTaskScheduled(runtimeState, replyConfig, dueTasks, Date.now());
      }
    }
  } finally {
    await chatPage?.close().catch(() => {});
  }

  log("主线:停止", CHAT_MONITOR_LOG_MODULE_NAME, "结束轮询", "收到停止信号，聊天监控轮询结束");
}

module.exports = {
  CHAT_MONITOR_LOG_MODULE_NAME,
  bootstrapSharedChatMonitorPage,
  createChatMonitorRuntimeState,
  monitorSharedChatWorkflow,
  resolveDueChatMonitorTasks,
  resolveSharedSnapshotPageSize,
  runDueChatMonitorTasks
};
