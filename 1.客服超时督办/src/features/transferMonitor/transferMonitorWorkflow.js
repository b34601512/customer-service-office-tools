const { log } = require("../../engine/logger");
const { appendSupervisorProcessRecord } = require("../supervision/supervisionReport");
const { verifyTransferCandidateByMessages } = require("./transferEventVerifier");
const {
  buildTransferContactState,
  detectTransferCandidates
} = require("./transferMonitorPolicy");
const {
  buildEmptyTransferMonitorState,
  writeTransferMonitorState
} = require("./transferMonitorStateStore");
const { sendTransferReminder } = require("./transferNotifier");

const TRANSFER_MONITOR_MODE_NAME = "独立转接监控=仅客服转客服";
const TRANSFER_MONITOR_PROMPT_TRACE =
  "独立转接监控先识别接待人变化，再核验消息事件来源；只有上一位客服人工转给另一位客服时，才提醒新客服及时回复";

function formatAssignedAtText(timestampMs) {
  // 这里统一把接口时间戳转成中文时间，保证日志和群文案都能直接看懂。
  const numericTimestamp = Number(timestampMs);
  if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
    return "";
  }

  return new Date(numericTimestamp).toLocaleString("zh-CN", { hour12: false });
}

function createTransferMonitorRuntimeState() {
  // 这里启动时只建立空基线，避免重启后补发停机期间已经发生的历史转接。
  const initialState = buildEmptyTransferMonitorState();
  return {
    contactsByChatId:
      initialState.contactsByChatId && typeof initialState.contactsByChatId === "object"
        ? initialState.contactsByChatId
        : {},
    lastSummaryKey: ""
  };
}

function persistTransferMonitorRuntimeState(runtimeState) {
  // 这里统一把内存里的最新接待快照写回磁盘，只用于排查当前监控看到的真实状态。
  writeTransferMonitorState({
    contactsByChatId: runtimeState.contactsByChatId
  });
}

function mergeCurrentContactsIntoRuntimeState(runtimeState, contacts) {
  // 这里在每轮扫描后只保留最新联系人接待快照，避免历史客户长期堆在基线里拖慢比较。
  const currentContactsByChatId = {};
  for (const contact of Array.isArray(contacts) ? contacts : []) {
    const currentState = buildTransferContactState(contact);
    if (!currentState.chatId) {
      continue;
    }

    currentContactsByChatId[currentState.chatId] = currentState;
  }
  runtimeState.contactsByChatId = currentContactsByChatId;
}

function logTransferMonitorSummary(
  runtimeState,
  contacts,
  rawCandidates,
  verifiedCandidates,
  skippedHistoricalCandidates
) {
  // 这里只在摘要变化时打印一次总览，顺便区分原始候选和人工转接候选，方便排查误报。
  const assignedContacts = (Array.isArray(contacts) ? contacts : []).filter(
    (contact) => String(contact?.assignedToUserId || "").trim()
  );
  const summaryKey = [
    Array.isArray(contacts) ? contacts.length : 0,
    assignedContacts.length,
    Array.isArray(rawCandidates) ? rawCandidates.length : 0,
    Number(skippedHistoricalCandidates) || 0,
    Array.isArray(verifiedCandidates) ? verifiedCandidates.length : 0,
    Array.isArray(verifiedCandidates) && verifiedCandidates.length > 0
      ? `${verifiedCandidates[0].customerName}:${verifiedCandidates[0].actionLabel}`
      : "none"
  ].join("|");
  if (runtimeState.lastSummaryKey === summaryKey) {
    return;
  }

  runtimeState.lastSummaryKey = summaryKey;
  log(
    "主线:执行",
    "转接监控",
    "刷新任务视图",
    `联系人=${Array.isArray(contacts) ? contacts.length : 0}，已分配=${assignedContacts.length}，当日候选=${Array.isArray(rawCandidates) ? rawCandidates.length : 0}，历史过滤=${Number(skippedHistoricalCandidates) || 0}，人工转接候选=${Array.isArray(verifiedCandidates) ? verifiedCandidates.length : 0}${Array.isArray(verifiedCandidates) && verifiedCandidates.length > 0 ? `，最新候选=${verifiedCandidates[0].customerName}` : ""}`
  );
}

function recordTransferProcess(input) {
  // 这里把独立转接提醒动作落进统一过程看板，方便后续回看与排障。
  appendSupervisorProcessRecord({
    occurredAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    customerName: input.customerName,
    statusLabel: "已发送转接提醒",
    modeName: TRANSFER_MONITOR_MODE_NAME,
    promptTrace: TRANSFER_MONITOR_PROMPT_TRACE,
    queueRawText: "",
    queuePreviewText: input.previewText || "",
    queueTimeText: input.assignedAtText || "",
    waitMarkerText: input.actionLabel,
    lastCustomerMessage: "",
    recentAgentReply: "",
    customerContext: `上一位处理人ID：${input.previousAssignedToUserId || "无"}`,
    reason: input.reason,
    pendingDurationSeconds: null,
    assigneeName: input.assigneeName,
    assigneeRoleLabel: input.assigneeRoleLabel,
    escalationStatus: "已发送转接提醒",
    escalationWebhookName: input.webhookName,
    dispatchAction: "transfer_monitor_reminder",
    dispatchTarget: `${input.assigneeName}（${input.assigneeRoleLabel || "未识别角色"}）`,
    dispatchRawText: input.transferReminderEventKey,
    messages: []
  });
}

async function processTransferCandidate(runtimeState, candidate, memberMapByUserId) {
  // 这里只有“客服转客服”才会走到这里，提醒成功后立即写入新基线，防止同一事件重复发送。
  const assigneeMember = memberMapByUserId[candidate.assignedToUserId];
  if (!assigneeMember) {
    throw new Error(
      `独立转接监控未找到成员映射：客服ID=${candidate.assignedToUserId}，客户=${candidate.customerName}`
    );
  }

  const assignedAtText = formatAssignedAtText(candidate.lastAssignedTimestamp);
  const reminderResult = await sendTransferReminder({
    customerName: candidate.customerName,
    assignedAtText,
    actionLabel: candidate.actionLabel,
    assigneeMember
  });
  runtimeState.contactsByChatId[candidate.chatId] = buildTransferContactState(candidate);
  persistTransferMonitorRuntimeState(runtimeState);
  const reason =
    `检测到客户从上一位客服转给新客服，动作=${candidate.actionLabel}，` +
    `上一位客服ID=${candidate.previousAssignedToUserId || "未识别"}，` +
    `转出客服=${candidate.operatorUserName || candidate.operatorUserId || "未识别"}，` +
    `当前客服=${assigneeMember.staffName}，时间=${assignedAtText || "未识别"}`;
  recordTransferProcess({
    customerName: candidate.customerName,
    previewText: candidate.previewText,
    assignedAtText,
    actionLabel: candidate.actionLabel,
    assigneeName: assigneeMember.staffName,
    assigneeRoleLabel: assigneeMember.roleLabel,
    previousAssignedToUserId: candidate.previousAssignedToUserId,
    webhookName: reminderResult.webhookName,
    reason,
    transferReminderEventKey: candidate.transferReminderEventKey
  });
  log(
    "主线:完成",
    "转接监控",
    "发送提醒",
    `客户=${candidate.customerName}，动作=${candidate.actionLabel}，转出=${candidate.operatorUserName || candidate.operatorUserId || "未识别"}，转入=${assigneeMember.staffName}，已通知${reminderResult.webhookName}`
  );
}

async function verifyTransferCandidates(page, candidates) {
  // 这里把“接待人变化候选”收窄成“已确认人工转人工”的最终候选，避免系统分配误提醒。
  const verifiedCandidates = [];

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const decision = await verifyTransferCandidateByMessages(page, candidate);
    if (!decision.shouldRemind) {
      continue;
    }

    verifiedCandidates.push({
      ...candidate,
      operatorUserId: decision.matchedEvent?.opUserId || "",
      operatorUserName: decision.matchedEvent?.opUserName || ""
    });
  }

  return verifiedCandidates;
}

async function runTransferMonitorScanWithSnapshot(page, runtimeState, snapshot) {
  // 这里执行单轮转接判断：消费共享快照，只有候选事件才读取消息核验来源。
  const detectionResult = detectTransferCandidates(runtimeState.contactsByChatId, snapshot.contacts);
  const verifiedCandidates = await verifyTransferCandidates(page, detectionResult.candidates);
  logTransferMonitorSummary(
    runtimeState,
    snapshot.contacts,
    detectionResult.candidates,
    verifiedCandidates,
    detectionResult.skippedHistoricalCandidates
  );

  for (const candidate of verifiedCandidates) {
    await processTransferCandidate(runtimeState, candidate, snapshot.memberMapByUserId);
  }

  mergeCurrentContactsIntoRuntimeState(runtimeState, snapshot.contacts);
  persistTransferMonitorRuntimeState(runtimeState);
}

module.exports = {
  TRANSFER_MONITOR_MODE_NAME,
  TRANSFER_MONITOR_PROMPT_TRACE,
  createTransferMonitorRuntimeState,
  formatAssignedAtText,
  mergeCurrentContactsIntoRuntimeState,
  runTransferMonitorScanWithSnapshot
};
