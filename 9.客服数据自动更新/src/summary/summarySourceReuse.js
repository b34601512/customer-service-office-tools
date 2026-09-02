// 该文件只判断"今天是否已为本店下载过这份源文件且文件仍在"，供单店/本轮复用，避免重复下载。
const fs = require("fs");
const path = require("path");
const { readTaskHistory } = require("../shared/taskHistoryParts/taskHistoryStore");

const DAY_MS = 24 * 60 * 60 * 1000;

function isReusableSummarySourceFile(filePath) {
  // 这个函数只认仍存在、非空且格式明确的 Excel 源文件。
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath || !/\.(xlsx|xlsm|xls)$/i.test(path.extname(normalizedPath))) {
    return false;
  }
  if (!fs.existsSync(normalizedPath)) {
    return false;
  }
  const stat = fs.statSync(normalizedPath);
  return stat.isFile() && stat.size > 0;
}

function normalizeComparablePath(filePath) {
  // 这个函数统一文件路径比较口径，避免 Windows 路径大小写差异破坏判定。
  const normalizedPath = String(filePath || "").trim();
  return normalizedPath ? path.normalize(normalizedPath).toLowerCase() : "";
}

function resolveExpectedDateRange(dateRange) {
  // 这个函数只提取本轮日期，下载记录必须命中同一范围。
  return {
    startText: String(dateRange?.startText || dateRange?.start?.customDate || "").trim(),
    endText: String(dateRange?.endText || dateRange?.end?.customDate || "").trim()
  };
}

function resolveNowDate(value) {
  // 这个函数只把测试或运行时传入的当前时间整理成有效 Date。
  const candidate = typeof value === "function" ? value() : value;
  const resolvedDate = candidate instanceof Date
    ? new Date(candidate.getTime())
    : new Date(candidate || Date.now());
  return Number.isFinite(resolvedDate.getTime()) ? resolvedDate : new Date();
}

function formatLocalDayText(value) {
  // 这个函数只把时间戳格式化成本地 yyyy-MM-dd，用于判断"是否今天下载"。
  const date = resolveNowDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateTextToDayStartMs(dateText) {
  // 这个函数只解析 YYYY-MM-DD 为当天 0 点毫秒，不接受歧义输入。
  const matchedDate = String(dateText || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchedDate) {
    return NaN;
  }
  const year = Number(matchedDate[1]);
  const month = Number(matchedDate[2]);
  const day = Number(matchedDate[3]);
  return Date.UTC(year, month - 1, day);
}

function isDownloadedToday(record, now = new Date()) {
  // 这个函数只判断下载记录是否发生在今天（本地日期），不关心文件内容。
  const createdAtMs = Date.parse(String(record?.createdAt || ""));
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  return formatLocalDayText(createdAtMs) === formatLocalDayText(now);
}

function resolveSummarySourceReuseDecision({ record, now = new Date() }) {
  // 这个函数只判断源文件是否今天下载，是则可复用，否则重新下载。
  if (isDownloadedToday(record, now)) {
    return {
      canReuse: true,
      reason: "源文件为今天下载，允许复用。"
    };
  }
  return {
    canReuse: false,
    reason: "源文件不是今天下载，重新下载。"
  };
}

function findReusableSummarySourceFile({
  platformKey,
  storeKey,
  reportKeys,
  requiredReportKeys = reportKeys,
  dateRange,
  history: providedHistory,
  now,
  nowFn,
  onReuseDecision
}) {
  // 这个函数只复用今天下载且仍存在的最新源文件；非今天下载一律不复用。
  const history = providedHistory || readTaskHistory();
  const requiredKeys = [...new Set((Array.isArray(requiredReportKeys) ? requiredReportKeys : []).filter(Boolean))];
  const expectedRange = resolveExpectedDateRange(dateRange);
  const reportKeySet = new Set((Array.isArray(reportKeys) ? reportKeys : []).filter(Boolean));
  const resolvedNow = nowFn || now;
  const sourceRecord = history.downloads
    .filter((record) =>
      record.platformKey === platformKey &&
      record.storeKey === storeKey &&
      record.exportStartText === expectedRange.startText &&
      record.exportEndText === expectedRange.endText &&
      reportKeySet.has(record.reportKey)
    )
    .filter((record) => isDownloadedToday(record, resolvedNow))
    .filter((record) => isReusableSummarySourceFile(record.filePath))
    .filter((record) => Array.isArray(record.sourceReportKeys) &&
      requiredKeys.every((reportKey) => record.sourceReportKeys.includes(reportKey)))
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0] || null;
  if (!sourceRecord) {
    onReuseDecision?.({
      canReuse: false,
      reason: "没有找到今天下载且仍存在、匹配当前店铺、日期和报表范围的历史源文件，重新下载。"
    });
    return null;
  }

  const freshnessDecision = resolveSummarySourceReuseDecision({
    record: sourceRecord,
    now: nowFn || now
  });
  if (!freshnessDecision.canReuse) {
    onReuseDecision?.({ ...freshnessDecision, record: sourceRecord });
    return null;
  }

  // 新模型下"今天下载且文件存在"即视为可复用并重新导入，不再依赖历史导入记录。
  const result = {
    ...sourceRecord,
    alreadyImported: true,
    reuseDecisionReason: freshnessDecision.reason
  };
  onReuseDecision?.({
    canReuse: true,
    reason: freshnessDecision.reason,
    record: result
  });
  return result;
}

module.exports = {
  findReusableSummarySourceFile,
  isReusableSummarySourceFile,
  isDownloadedToday,
  resolveSummarySourceReuseDecision,
  formatLocalDayText,
  DAY_MS
};
