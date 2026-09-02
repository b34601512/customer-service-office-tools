// 该文件用于控制倒计时和资源占用弹窗的打开、关闭和即时刷新。
function setCountdownModalVisible(isVisible) {
  // 这里统一控制倒计时弹窗显隐，保证按钮状态、遮罩和页面滚动一致。
  if (!countdownModal) {
    return;
  }

  countdownModal.classList.toggle("hidden", !isVisible);
  countdownModal.setAttribute("aria-hidden", isVisible ? "false" : "true");
  document.body.classList.toggle("modal-open", isVisible);
  if (openCountdownModalButton) {
    openCountdownModalButton.setAttribute("aria-expanded", isVisible ? "true" : "false");
  }
}

function openCountdownModal() {
  // 这里打开倒计时明细并立即刷新一次，避免用户看到旧秒数。
  countdownModalTriggerButton = document.activeElement;
  renderCountdownModal(latestDashboardSnapshot || {});
  setCountdownModalVisible(true);
  if (closeCountdownModalButton && typeof closeCountdownModalButton.focus === "function") {
    closeCountdownModalButton.focus();
  }
}

function closeCountdownModal() {
  // 这里关闭倒计时明细并把焦点还给触发按钮，键盘操作不会丢位置。
  customerMirrorCountdown.closeDetail();
  setCountdownModalVisible(false);
  if (countdownModalTriggerButton && typeof countdownModalTriggerButton.focus === "function") {
    countdownModalTriggerButton.focus();
  } else if (openCountdownModalButton && typeof openCountdownModalButton.focus === "function") {
    openCountdownModalButton.focus();
  }
}

function setResourceUsageModalVisible(isVisible) {
  // 这里统一控制资源占用弹窗显隐，保证按钮状态、遮罩和页面滚动一致。
  if (!resourceUsageModal) {
    return;
  }

  resourceUsageModal.classList.toggle("hidden", !isVisible);
  resourceUsageModal.setAttribute("aria-hidden", isVisible ? "false" : "true");
  document.body.classList.toggle("modal-open", isVisible);
  if (openResourceUsageModalButton) {
    openResourceUsageModalButton.setAttribute("aria-expanded", isVisible ? "true" : "false");
  }
}

async function refreshResourceUsage() {
  // 这里请求后端真实采样结果，不在前端猜测本机资源占用。
  renderResourceUsageLoading();
  if (refreshResourceUsageButton) {
    setButtonBusy(refreshResourceUsageButton, "刷新中...");
  }

  try {
    const result = await requestJson("/api/system/resources", { method: "GET" });
    renderResourceUsage(result.resources || {});
  } catch (error) {
    renderResourceUsageError(error.message);
    setFeedback(error.message, true, {
      title: "资源读取失败",
      workflowStep: "monitor"
    });
  } finally {
    if (refreshResourceUsageButton) {
      clearButtonBusy(refreshResourceUsageButton);
    }
  }
}

function openResourceUsageModal() {
  // 这里打开弹窗后立即采样一次，让用户看到的是点击时的真实占用。
  resourceUsageModalTriggerButton = document.activeElement;
  setResourceUsageModalVisible(true);
  refreshResourceUsage();
  if (closeResourceUsageModalButton && typeof closeResourceUsageModalButton.focus === "function") {
    closeResourceUsageModalButton.focus();
  }
}

function closeResourceUsageModal() {
  // 这里关闭资源占用弹窗并把焦点还给触发按钮，键盘操作不会丢位置。
  setResourceUsageModalVisible(false);
  if (resourceUsageModalTriggerButton && typeof resourceUsageModalTriggerButton.focus === "function") {
    resourceUsageModalTriggerButton.focus();
  } else if (openResourceUsageModalButton && typeof openResourceUsageModalButton.focus === "function") {
    openResourceUsageModalButton.focus();
  }
}
