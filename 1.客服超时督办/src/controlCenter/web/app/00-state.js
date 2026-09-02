// 该文件用于集中保存首页控制台的 DOM 引用、常量和基础格式化函数。
const feedbackStack = document.getElementById("feedbackStack");
const confirmLoginButton = document.getElementById("confirmLoginButton");
const stopTaskButton = document.getElementById("stopTaskButton");
const monitorUpdatedAtValue = document.getElementById("monitorUpdatedAtValue");
const workflowStatusText = document.getElementById("workflowStatusText");
const openCountdownModalButton = document.getElementById("openCountdownModalButton");
const countdownAttentionBadge = document.getElementById("countdownAttentionBadge");
const closeCountdownModalButton = document.getElementById("closeCountdownModalButton");
const countdownModal = document.getElementById("countdownModal");
const customerMirrorList = document.getElementById("customerMirrorList");
const customerMirrorSummary = document.getElementById("customerMirrorSummary");
const customerMirrorDetailModal = document.getElementById("customerMirrorDetailModal");
const customerMirrorDetailTitle = document.getElementById("customerMirrorDetailTitle");
const customerMirrorDetailSubtitle = document.getElementById("customerMirrorDetailSubtitle");
const customerMirrorDetailBody = document.getElementById("customerMirrorDetailBody");
const closeCustomerMirrorDetailButton = document.getElementById("closeCustomerMirrorDetailButton");
const openResourceUsageModalButton = document.getElementById("openResourceUsageModalButton");
const closeResourceUsageModalButton = document.getElementById("closeResourceUsageModalButton");
const refreshResourceUsageButton = document.getElementById("refreshResourceUsageButton");
const resourceUsageModal = document.getElementById("resourceUsageModal");
const resourceUsageSummary = document.getElementById("resourceUsageSummary");
const resourceUsageProcessList = document.getElementById("resourceUsageProcessList");
const resourceUsageUpdatedAt = document.getElementById("resourceUsageUpdatedAt");
const workflowSteps = {
  login: {
    item: document.getElementById("workflowStepLogin"),
    state: document.getElementById("workflowLoginState"),
    time: document.getElementById("workflowLoginTime"),
    detail: document.getElementById("workflowLoginDetail")
  },
  start: {
    item: document.getElementById("workflowStepStart"),
    state: document.getElementById("workflowStartState"),
    time: document.getElementById("workflowStartTime"),
    detail: document.getElementById("workflowStartDetail")
  },
  monitor: {
    item: document.getElementById("workflowStepMonitor"),
    state: document.getElementById("workflowMonitorState"),
    time: document.getElementById("workflowMonitorTime"),
    detail: document.getElementById("workflowMonitorDetail")
  },
  result: {
    item: document.getElementById("workflowStepResult"),
    state: document.getElementById("workflowResultState"),
    time: document.getElementById("workflowResultTime"),
    detail: document.getElementById("workflowResultDetail")
  },
  config: {
    item: document.getElementById("workflowStepConfig"),
    state: document.getElementById("workflowConfigState"),
    time: document.getElementById("workflowConfigTime"),
    detail: document.getElementById("workflowConfigDetail")
  }
};

const FEEDBACK_TYPE_META = {
  info: {
    title: "等待操作",
    className: "is-info"
  },
  pending: {
    title: "正在处理",
    className: "is-pending"
  },
  success: {
    title: "操作成功",
    className: "is-success"
  },
  error: {
    title: "操作失败",
    className: "is-error"
  }
};

const WORKFLOW_STATE_LABELS = {
  idle: "待操作",
  ok: "正常",
  running: "进行中",
  warning: "需要关注"
};

const FEEDBACK_WORKFLOW_STATES = {
  info: "idle",
  pending: "running",
  success: "ok",
  error: "warning"
};

let currentTask = null;
let dashboardRefreshTimer = null;
let durationRefreshTimer = null;
let eventSource = null;
let isControlCenterClosing = false;
let feedbackToastSerial = 0;
let latestLoginStatus = null;
let latestDashboardSnapshot = null;
let countdownModalTriggerButton = null;
let resourceUsageModalTriggerButton = null;

function escapeHtml(value) {
  // 这里统一转义关键事件文本，避免反馈文案夹带特殊字符把页面结构打坏。
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDuration(startedAt) {
  // 这里把运行时长转成短文本，方便首页一直显示后台已经跑了多久。
  if (!startedAt) {
    return "未运行";
  }

  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "未运行";
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}小时 ${String(minutes).padStart(2, "0")}分 ${String(seconds).padStart(2, "0")}秒`;
  }

  if (minutes > 0) {
    return `${minutes}分 ${String(seconds).padStart(2, "0")}秒`;
  }

  return `${seconds}秒`;
}
