function bindClick(element, handler) {
  if (!element) return;
  element.addEventListener("click", handler);
}

function setFeedback(message, state = "info") {
  if (!feedback) return;
  feedback.textContent = message || "";
  feedback.dataset.state = state;
}

function setConfigDialogFeedback(message, state = "info") {
  if (!configDialogFeedback) return;
  configDialogFeedback.textContent = message || "";
  configDialogFeedback.dataset.state = state;
}

function setConfigDialogVisible(isVisible) {
  // 该函数统一控制配置弹窗，避免旧配置页和首页弹窗两套入口继续混用。
  if (!configPanel) return;
  configPanel.classList.toggle("hidden", !isVisible);
  if (typeof configPanel.setAttribute === "function") {
    configPanel.setAttribute("aria-hidden", isVisible ? "false" : "true");
  }
  if (document.body?.classList) {
    document.body.classList.toggle("modal-open", isVisible);
  }
  if (configButton && typeof configButton.setAttribute === "function") {
    configButton.setAttribute("aria-expanded", isVisible ? "true" : "false");
  }
}

function openConfigDialog() {
  // 该函数用于在首页打开运行配置弹窗，配置表单仍复用原来的保存逻辑。
  renderForm(window.latestForm || {});
  setConfigDialogFeedback("");
  setConfigDialogVisible(true);
}

function closeConfigDialog() {
  // 该函数用于关闭配置弹窗；如果来自旧 /config 地址，则回到干净首页地址。
  setConfigDialogVisible(false);
  if (window.location?.pathname?.startsWith("/config")) {
    window.history?.replaceState?.(null, "", "/");
  }
}

function closeConfigDialogFromBackdrop(event) {
  if (event.target === configPanel) {
    closeConfigDialog();
  }
}

function closeConfigDialogOnEscape(event) {
  if (event.key === "Escape" && configPanel && !String(configPanel.className || "").split(/\s+/).includes("hidden")) {
    closeConfigDialog();
  }
}

function openInitialDialogFromPath() {
  if (window.location?.pathname?.startsWith("/config")) {
    openConfigDialog();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
