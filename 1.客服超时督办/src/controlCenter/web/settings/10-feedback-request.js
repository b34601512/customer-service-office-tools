// 该文件用于配置中心反馈提示、按钮状态和本地接口请求。
function escapeConfigHtml(value) {
  // 这里统一转义界面文案，避免输入值里的特殊字符把卡片结构打坏。
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveFeedbackElements(container) {
  return {
    title: container.querySelector("[data-feedback-title]"),
    message: container.querySelector("[data-feedback-message]")
  };
}

function renderFeedbackBanner(container, message, type = "info", options = {}) {
  // 这里统一渲染配置页反馈条，让每次保存的结果都落在固定位置。
  const meta = CONFIG_FEEDBACK_TYPE_META[type] || CONFIG_FEEDBACK_TYPE_META.info;
  const refs = resolveFeedbackElements(container);
  container.className = `feedback-banner ${meta.className}`;
  if (refs.title) {
    refs.title.textContent = options.title || meta.title;
  }
  if (refs.message) {
    refs.message.textContent = String(message || "");
  }
}

function showConfigFeedbackToast(message, type = "success", options = {}) {
  // 这里补一个右上角浮层提示，避免用户保存后还要滚动找结果。
  const meta = CONFIG_FEEDBACK_TYPE_META[type] || CONFIG_FEEDBACK_TYPE_META.info;
  const toast = document.createElement("section");
  toast.className = `feedback-toast ${meta.className}`;
  toast.dataset.toastId = `feedback-toast-${Date.now()}-${(configFeedbackToastSerial += 1)}`;
  toast.innerHTML = `
    <strong class="feedback-toast-title">${escapeConfigHtml(options.title || meta.title)}</strong>
    <p class="feedback-toast-message">${escapeConfigHtml(message)}</p>
  `;
  configFeedbackStack.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, options.durationMs || (type === "error" ? 5000 : 2800));
}

function setSectionFeedback(container, message, isError = false, options = {}) {
  // 这里统一收口配置页反馈，横幅和浮层保持同一口径。
  const type = options.type || (isError ? "error" : "success");
  renderFeedbackBanner(container, message, type, options);
  if (options.showToast ?? !options.silent) {
    showConfigFeedbackToast(message, type, options);
  }
}

function setConfigFeedback(message, isError = false, options = {}) {
  // 这里同步刷新同一个生产配置表单的所有反馈条，避免保存后用户切页看不到结果。
  const type = options.type || (isError ? "error" : "success");
  [configFeedback, ...sharedConfigFeedbackItems].filter(Boolean).forEach((container) => {
    renderFeedbackBanner(container, message, type, options);
  });
  if (options.showToast ?? !options.silent) {
    showConfigFeedbackToast(message, type, options);
  }
}

function setConfigButtonBusy(button, pendingText) {
  // 这里统一切换按钮的处理中态，避免重复提交。
  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add("is-busy");
  button.dataset.originalText = originalText;
  button.textContent = pendingText;
}

function clearConfigButtonBusy(button, fallbackText = "") {
  // 这里统一恢复按钮文本和可点击状态，确保保存结束后界面回到稳定态。
  const originalText = button.dataset.originalText || fallbackText || button.textContent;
  button.disabled = false;
  button.classList.remove("is-busy");
  button.textContent = originalText;
  delete button.dataset.originalText;
}

// requestJson 由 /shared/requestJson.js 提供；原 requestConfigJson 与它逐字一致，已统一收口改名（issue #551）。
