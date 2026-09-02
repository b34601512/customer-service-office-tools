const NUMBER_TIMESTAMP_FIELDS = [
  "sentAtMs",
  "completedAtMs",
  "reminderSentAtMs",
  "lastReminderAtMs",
  "timeoutReminderSentAtMs",
  "missedReplyReminderSentAtMs",
  "lastCustomerMessageAtMs",
  "latestMessageAtMs",
  "scannedAtMs",
  "assignedAtMs",
  "lastAssignedTimestamp"
];

const TEXT_TIMESTAMP_FIELDS = [
  "sentAt",
  "completedAt",
  "scannedAt",
  "updatedAt",
  "assignedAt"
];

function normalizeObjectMap(value) {
  // 该函数把状态对象池收口成普通对象，避免数组或空值进入裁剪流程。
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseTimestampText(value) {
  // 该函数解析状态里的时间文本，让旧状态也能按时间裁剪。
  const timestampMs = Date.parse(String(value || ""));
  return Number.isFinite(timestampMs) ? timestampMs : 0;
}

function resolveEntryTimestampMs(entryValue) {
  // 该函数按常见时间字段找到状态条目的业务时间，找不到时交给数量上限兜住。
  if (!entryValue || typeof entryValue !== "object") {
    return 0;
  }

  for (const fieldName of NUMBER_TIMESTAMP_FIELDS) {
    const numericValue = Number(entryValue[fieldName]);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }
  }

  for (const fieldName of TEXT_TIMESTAMP_FIELDS) {
    const timestampMs = parseTimestampText(entryValue[fieldName]);
    if (timestampMs > 0) {
      return timestampMs;
    }
  }

  return 0;
}

function isExpiredEntry(entryValue, nowMs, retentionMs) {
  // 该函数只按有明确时间的旧条目过期，没时间的条目由数量上限处理，避免误删未知结构。
  const timestampMs = resolveEntryTimestampMs(entryValue);
  return timestampMs > 0 && retentionMs > 0 && nowMs - timestampMs > retentionMs;
}

function sortEntriesByTimestampDesc(entries) {
  // 该函数把最新状态排在前面，数量超限时优先保留最近现场。
  return entries
    .slice()
    .sort((left, right) => resolveEntryTimestampMs(right[1]) - resolveEntryTimestampMs(left[1]));
}

function pruneObjectMapByAgeAndCount(objectMap, options = {}) {
  // 该函数统一按保留天数和最大条数裁剪对象池，避免各状态库各写一套规则。
  const nowMs = Number(options.nowMs || Date.now());
  const retentionMs = Math.max(0, Number(options.retentionMs || 0));
  const maxEntries = Math.max(0, Number(options.maxEntries || 0));
  const alwaysKeepKeys = new Set((options.alwaysKeepKeys || []).map((item) => String(item || "")));
  let removedByAge = 0;
  let removedByCount = 0;

  const freshEntries = Object.entries(normalizeObjectMap(objectMap)).filter(([entryKey, entryValue]) => {
    if (alwaysKeepKeys.has(entryKey)) {
      return true;
    }
    if (isExpiredEntry(entryValue, nowMs, retentionMs)) {
      removedByAge += 1;
      return false;
    }
    return true;
  });

  if (maxEntries <= 0 || freshEntries.length <= maxEntries) {
    return {
      objectMap: Object.fromEntries(freshEntries),
      removedCount: removedByAge,
      removedByAge,
      removedByCount
    };
  }

  const keptEntries = [];
  for (const entry of sortEntriesByTimestampDesc(freshEntries)) {
    if (alwaysKeepKeys.has(entry[0]) || keptEntries.length < maxEntries) {
      keptEntries.push(entry);
      continue;
    }
    removedByCount += 1;
  }

  return {
    objectMap: Object.fromEntries(keptEntries),
    removedCount: removedByAge + removedByCount,
    removedByAge,
    removedByCount
  };
}

module.exports = {
  pruneObjectMapByAgeAndCount,
  resolveEntryTimestampMs
};
