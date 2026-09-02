const fs = require("fs");
const appConfig = require("../config/appConfig");
const { readJsonObjectSafe } = require("../engine/safeJson");
const { readMissedReplyMonitorState } = require("../features/missedReplyMonitor/missedReplyStateStore");
const { buildCustomerMirrorItems } = require("./customerMirrorListBuilder");

const DATA_FRESHNESS_STALE_THRESHOLD_SECONDS = 120;

function buildEmptyReportState() {
  // 这里只兜住过程记录，首页健康状态不再读取旧客户列表快照。
  return {
    generatedAt: "",
    modeName: "",
    promptTrace: "",
    records: []
  };
}

function readReportState() {
  // 这里读取轻量过程记录，首页只展示最近动作，不参与绩效统计。
  return readJsonObjectSafe(
    appConfig.supervisionProcessStatePath,
    buildEmptyReportState,
    "督办过程记录"
  );
}

function buildLatestRecord(record) {
  // 这里把最近一次处理记录压缩成首页摘要，避免把整段会话明细堆到主控制台。
  if (!record) {
    return {
      occurredAt: "",
      customerName: "暂无",
      statusLabel: "暂无处理记录",
      reason: "后台启动后，面板会自动显示最近一次处理结果。",
      assigneeName: "",
      assigneeRoleLabel: ""
    };
  }

  return {
    occurredAt: String(record.occurredAt || ""),
    customerName: String(record.customerName || "未识别客户"),
    statusLabel: String(record.statusLabel || "未记录结果"),
    reason: String(record.reason || ""),
    assigneeName: String(record.assigneeName || ""),
    assigneeRoleLabel: String(record.assigneeRoleLabel || "")
  };
}

function formatTimestampMs(timestampMs) {
  // 这里把客户判定时间转成首页可读文本，避免前端再猜时间格式。
  const numericTimestampMs = Number(timestampMs || 0);
  if (!Number.isFinite(numericTimestampMs) || numericTimestampMs <= 0) {
    return "";
  }

  return new Date(numericTimestampMs).toLocaleString("zh-CN", { hour12: false });
}

function resolveLatestDecisionScannedAtMs(customerMirrorItems) {
  // 这里只从统一未回复引擎的客户判定里取最新时间，彻底避开旧队列快照。
  return Math.max(
    0,
    ...customerMirrorItems.map((item) => Number(item.missedReplyScannedAtMs || 0))
  );
}

function buildDataFreshness(customerMirrorItems, nowMs = Date.now()) {
  // 这里用真实客户判定的最大扫描时间计算新鲜度，绝不使用控制台读文件时间。
  const lastScannedAtMs = resolveLatestDecisionScannedAtMs(customerMirrorItems);
  if (lastScannedAtMs <= 0) {
    return {
      lastScannedAtMs: 0,
      ageSeconds: null,
      stale: false
    };
  }

  const ageSeconds = Math.max(0, Math.floor((Number(nowMs) - lastScannedAtMs) / 1000));
  return {
    lastScannedAtMs,
    ageSeconds,
    stale: ageSeconds >= DATA_FRESHNESS_STALE_THRESHOLD_SECONDS
  };
}

function countAttentionCustomerMirrorItems(customerMirrorItems) {
  // 这里复用客户标签判断需关注数量，首页和弹窗表达同一套事实。
  return customerMirrorItems.filter((item) => {
    const statusTags = Array.isArray(item?.statusTags) ? item.statusTags : [];
    return statusTags.some((tag) => tag?.type === "warning" || tag?.type === "danger");
  }).length;
}

function buildMonitorSummary(missedReplyState, customerMirrorItems) {
  // 这里生成首页唯一运行巡检摘要：后台最近有没有完成真实判定。
  const latestDecisionScannedAtMs = resolveLatestDecisionScannedAtMs(customerMirrorItems);
  const updatedAtText = formatTimestampMs(latestDecisionScannedAtMs) || String(missedReplyState.updatedAt || "");
  const totalCount = customerMirrorItems.length;
  const attentionCount = countAttentionCustomerMirrorItems(customerMirrorItems);
  const hasData = Boolean(updatedAtText || totalCount > 0);

  return {
    hasData,
    updatedAtText,
    totalCount,
    attentionCount,
    stateText: hasData ? (attentionCount > 0 ? "需关注" : "已判定") : "等待判定",
    detailText: hasData
      ? `客户判定=${totalCount}，需关注=${attentionCount}`
      : "后台启动后，这里显示最近一次真实客户判定。"
  };
}

function readDashboardSnapshot(config) {
  // 这里统一汇总控制台首页数据，首页健康状态只看当前真实判定状态。
  const reportState = readReportState();
  const missedReplyState = readMissedReplyMonitorState();
  const latestRecord = buildLatestRecord((reportState.records || [])[0]);
  const nowMs = Date.now();
  const customerMirrorItems = buildCustomerMirrorItems(missedReplyState, nowMs);
  const dataFreshness = buildDataFreshness(customerMirrorItems, nowMs);
  const monitorSummary = buildMonitorSummary(missedReplyState, customerMirrorItems);

  return {
    generatedAt: String(reportState.generatedAt || ""),
    modeName: String(reportState.modeName || config.modeName || ""),
    promptTrace: String(reportState.promptTrace || ""),
    monitorSummary,
    dataFreshness,
    countdownSnapshotUpdatedAt: new Date(nowMs).toLocaleString("zh-CN", { hour12: false }),
    customerMirrorItems,
    latestRecord
  };
}

module.exports = {
  buildDataFreshness,
  buildMonitorSummary,
  resolveLatestDecisionScannedAtMs,
  readDashboardSnapshot
};
