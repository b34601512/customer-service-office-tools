function normalizeTransferValue(value) {
  return String(value || "").trim();
}

function normalizeTransferTimestamp(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : 0;
}

function isTransferTimestampWithinToday(timestamp, nowTimestamp = Date.now()) {
  // 这里把“今天”的边界收口成一个函数，避免各处重复手写日期判断而漏掉历史转接过滤。
  const normalizedTimestamp = normalizeTransferTimestamp(timestamp);
  const normalizedNowTimestamp = normalizeTransferTimestamp(nowTimestamp);
  if (normalizedTimestamp <= 0 || normalizedNowTimestamp <= 0) {
    return false;
  }

  const now = new Date(normalizedNowTimestamp);
  const dayStartTimestamp = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
  const nextDayStartTimestamp = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  ).getTime();
  return normalizedTimestamp >= dayStartTimestamp && normalizedTimestamp < nextDayStartTimestamp;
}

function buildTransferContactState(contact) {
  // 这里把联系人当前分配状态压成最小快照，后续去重和变更检测都只认这个结构。
  return {
    chatId: normalizeTransferValue(contact.chatId),
    customerName: normalizeTransferValue(contact.customerName),
    assignedToUserId: normalizeTransferValue(contact.assignedToUserId),
    lastAssignedTimestamp: normalizeTransferTimestamp(contact.lastAssignedTimestamp)
  };
}

function buildTransferReminderEventKey(input) {
  // 这里用“会话 + 分配时间 + 目标客服”生成稳定事件键，保证同一次转接只提醒一次。
  return [
    normalizeTransferValue(input.chatId),
    normalizeTransferTimestamp(input.lastAssignedTimestamp),
    normalizeTransferValue(input.assignedToUserId)
  ].join("::");
}

function buildTransitionActionLabel(previousState, currentState) {
  // 这里只有“原客服转给新客服”才算真正需要提醒的转接动作。
  const previousAssignedToUserId = normalizeTransferValue(previousState?.assignedToUserId);
  const currentAssignedToUserId = normalizeTransferValue(currentState?.assignedToUserId);
  if (!previousAssignedToUserId || !currentAssignedToUserId) {
    return "";
  }

  return previousAssignedToUserId !== currentAssignedToUserId ? "转接" : "";
}

function detectTransferCandidates(previousContactsByChatId, contacts, options = {}) {
  // 这里只有“上一轮已有人接待，本轮换成另一个客服”才算转接候选，系统首次分配不提醒。
  const previousStateMap = previousContactsByChatId && typeof previousContactsByChatId === "object"
    ? previousContactsByChatId
    : {};
  const candidates = [];
  const currentStateMap = {};
  const currentTimestamp = normalizeTransferTimestamp(options.nowTimestamp || Date.now()) || Date.now();
  let skippedHistoricalCandidates = 0;

  for (const contact of Array.isArray(contacts) ? contacts : []) {
    const currentState = buildTransferContactState(contact);
    if (!currentState.chatId) {
      continue;
    }

    currentStateMap[currentState.chatId] = currentState;
    const previousState = previousStateMap[currentState.chatId];
    if (!previousState) {
      continue;
    }

    if (!currentState.assignedToUserId || currentState.lastAssignedTimestamp <= 0) {
      continue;
    }

    const actionLabel = buildTransitionActionLabel(previousState, currentState);
    if (!actionLabel) {
      continue;
    }

    if (!isTransferTimestampWithinToday(currentState.lastAssignedTimestamp, currentTimestamp)) {
      skippedHistoricalCandidates += 1;
      continue;
    }

    candidates.push({
      ...contact,
      previousAssignedToUserId: normalizeTransferValue(previousState.assignedToUserId),
      previousLastAssignedTimestamp: normalizeTransferTimestamp(previousState.lastAssignedTimestamp),
      actionLabel,
      transferReminderEventKey: buildTransferReminderEventKey(currentState)
    });
  }

  return {
    candidates: candidates.sort(
      (left, right) =>
        normalizeTransferTimestamp(left.lastAssignedTimestamp) -
        normalizeTransferTimestamp(right.lastAssignedTimestamp)
    ),
    currentStateMap,
    skippedHistoricalCandidates
  };
}

module.exports = {
  buildTransferContactState,
  buildTransferReminderEventKey,
  detectTransferCandidates,
  isTransferTimestampWithinToday,
  normalizeTransferTimestamp,
  normalizeTransferValue
};
