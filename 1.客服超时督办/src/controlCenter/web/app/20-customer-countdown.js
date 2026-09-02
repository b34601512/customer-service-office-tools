// 该文件用于连接客户倒计时总览模块和首页弹窗。
function formatScanTime(timestampMs) {
  // 这里把最近判定时间显示到年月日秒，方便现场核对客户状态是否最新。
  const numericTimestamp = Number(timestampMs || 0);
  if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
    return "未扫描";
  }

  return new Date(numericTimestamp).toLocaleString("zh-CN", { hour12: false });
}

if (!window.createCustomerMirrorCountdownController) {
  throw new Error("倒计时客户总览模块未加载，请检查 countdown/customerMirrorList.js。");
}

const customerMirrorCountdown = window.createCustomerMirrorCountdownController({
  document,
  listElement: customerMirrorList,
  summaryElement: customerMirrorSummary,
  detailModalElement: customerMirrorDetailModal,
  detailTitleElement: customerMirrorDetailTitle,
  detailSubtitleElement: customerMirrorDetailSubtitle,
  detailBodyElement: customerMirrorDetailBody,
  detailCloseButton: closeCustomerMirrorDetailButton,
  escapeHtml,
  formatScanTime
});

function renderCountdownModal(dashboard = {}) {
  // 这里把倒计时弹窗交给独立总览模块，首页脚本不再混入客户详情渲染。
  customerMirrorCountdown.render(
    dashboard.customerMirrorItems || [],
    dashboard.dataFreshness || {}
  );
}

function countAttentionCustomerMirrorItems(customerMirrorItems = []) {
  // 这里按客户去重统计需关注数量，避免超时和漏回复两个标签把同一个客户重复计数。
  return customerMirrorItems.filter((item) => {
    const statusTags = Array.isArray(item?.statusTags) ? item.statusTags : [];
    return statusTags.some((tag) => tag?.type === "warning" || tag?.type === "danger");
  }).length;
}

function refreshCountdownAttentionBadge(dashboard = {}) {
  // 这里把同一份客户镜像数据同步到入口角标，避免按钮数字和弹窗列表各算一套。
  if (!countdownAttentionBadge || !openCountdownModalButton) {
    return;
  }

  const attentionCount = countAttentionCustomerMirrorItems(dashboard.customerMirrorItems || []);
  countdownAttentionBadge.textContent = attentionCount > 99 ? "99+" : String(attentionCount);
  countdownAttentionBadge.classList.toggle("hidden", attentionCount <= 0);
  openCountdownModalButton.title = attentionCount > 0 ? `有 ${attentionCount} 个客户需要关注` : "当前没有需要关注的客户";
}

function openCustomerMirrorDetailByIndex(index) {
  // 这里给页面和测试提供统一入口，按当前列表序号打开客户详情。
  customerMirrorCountdown.openDetailByIndex(index);
}
