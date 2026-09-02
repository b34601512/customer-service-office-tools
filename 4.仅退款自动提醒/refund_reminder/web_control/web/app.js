const appMetaBar = document.getElementById("appMetaBar");
const workflowGrid = document.getElementById("workflowGrid");
const workflowActionPool = document.getElementById("workflowActionPool");
const feedback = document.getElementById("feedback");
const configPanel = document.getElementById("configPanel");
const handledPanel = document.getElementById("handledPanel");
const configForm = document.getElementById("configForm");
const configFeedback = document.getElementById("configFeedback");
const logOutput = document.getElementById("logOutput");
const logDialog = document.getElementById("logDialog");
const logDialogOutput = document.getElementById("logDialogOutput");
const copyLogFeedback = document.getElementById("copyLogFeedback");
const openErpButton = document.getElementById("openErpButton");
const startMonitorButton = document.getElementById("startMonitorButton");
const stopMonitorButton = document.getElementById("stopMonitorButton");
const openLogButton = document.getElementById("openLogButton");
const copyLogButton = document.getElementById("copyLogButton");
const closeLogDialogButton = document.getElementById("closeLogDialogButton");
const exitButton = document.getElementById("exitButton");
const toggleHandledButton = document.getElementById("toggleHandledButton");
const toggleConfigButton = document.getElementById("toggleConfigButton");
const toggleLogButton = document.getElementById("toggleLogButton");
const closeHandledButton = document.getElementById("closeHandledButton");
const closeConfigButton = document.getElementById("closeConfigButton");
const saveButton = document.getElementById("saveButton");
const viewButtons = Array.from(document.querySelectorAll("[data-view-target]"));
const viewPanels = Array.from(document.querySelectorAll("[data-view-panel]"));
const indicatorOrder = ["browser", "monitor", "scan", "alert", "stats"];
const workflowActionTargets = {
  browser: [openErpButton],
  monitor: [startMonitorButton, stopMonitorButton],
  stats: [openLogButton, exitButton],
};
const indicatorStateLabels = {
  idle: "待命",
  ok: "正常",
  running: "进行中",
  warning: "需要关注",
};
let lastRuntimeSnapshot = null;
let statePollFailureCount = 0;
let statePollTimer = null;
let backendExitRequested = false;
let configuredDateRangeApplied = false;
let logDialogReturnButton = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setFeedback(message, state = "info", kind = "") {
  feedback.textContent = message || "";
  feedback.dataset.state = state;
  feedback.dataset.kind = kind || "";
}

function setConfigFeedback(message, state = "info") {
  // 该函数用于把配置保存结果显示在弹窗内，避免用户看不到顶部全局提示。
  if (!configFeedback) return;
  configFeedback.textContent = message || "";
  configFeedback.dataset.state = state;
}

function formatErrorMessage(error, fallback = "操作失败") {
  return error && error.message ? error.message : String(error || fallback);
}

function isNetworkFetchFailure(error) {
  // 该函数用于识别后台正常退出后浏览器产生的网络断开错误，避免误报成监控异常。
  const message = formatErrorMessage(error, "");
  return message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("Load failed");
}

function stopStatePolling() {
  // 该函数用于在后台已退出时停止轮询，避免旧页面继续请求已关闭的本地服务。
  if (statePollTimer !== null) {
    window.clearInterval(statePollTimer);
    statePollTimer = null;
  }
}

function markControlCenterExited(message) {
  // 该函数用于把用户主动退出后台后的页面状态固定下来，避免继续显示刷新失败。
  backendExitRequested = true;
  stopStatePolling();
  const text = message || "后台已退出，可以关闭这个网页。";
  setFeedback(text, "success");
  setWorkflowStatusText(text);
  document.title = "已退出｜退款自动提醒";
}

function clearRecoveredStatePollFeedback() {
  // 该函数用于清理已经恢复的轮询错误，避免一次短暂失败长期残留成红色误报。
  if (feedback.dataset.kind === "state-poll") setFeedback("");
}

function isDialogVisible(dialog) {
  // 该函数用于统一判断弹窗状态，避免 body 滚动锁被不同弹窗互相覆盖。
  return Boolean(dialog && !dialog.classList.contains("hidden"));
}

function syncModalOpenState() {
  // 该函数用于只在至少一个弹窗打开时锁定页面滚动。
  document.body.classList.toggle("modal-open", isDialogVisible(configPanel) || isDialogVisible(handledPanel) || isDialogVisible(logDialog));
}

function setConfigDialogVisible(isVisible) {
  // 该函数用于统一控制配置弹窗显隐，避免入口按钮、遮罩和键盘事件状态不一致。
  if (!configPanel) return;
  configPanel.classList.toggle("hidden", !isVisible);
  configPanel.setAttribute("aria-hidden", isVisible ? "false" : "true");
  if (toggleConfigButton) toggleConfigButton.setAttribute("aria-expanded", isVisible ? "true" : "false");
  syncModalOpenState();
  if (isVisible) {
    setConfigFeedback("");
    if (closeConfigButton) closeConfigButton.focus();
  } else if (toggleConfigButton) {
    toggleConfigButton.focus();
  }
}

function openConfigDialog() {
  // 该函数用于打开配置弹窗，让配置项不再常驻占用后台页面。
  setConfigDialogVisible(true);
}

function closeConfigDialog() {
  // 该函数用于关闭配置弹窗并回到触发按钮。
  setConfigDialogVisible(false);
}

function setHandledDialogVisible(isVisible) {
  // 该函数用于把已处理订单收进弹窗，避免顶部导航切到新页面后界面变重。
  if (!handledPanel) return;
  handledPanel.classList.toggle("hidden", !isVisible);
  handledPanel.setAttribute("aria-hidden", isVisible ? "false" : "true");
  if (toggleHandledButton) toggleHandledButton.setAttribute("aria-expanded", isVisible ? "true" : "false");
  syncModalOpenState();
  if (isVisible) {
    if (closeHandledButton) closeHandledButton.focus();
  } else if (toggleHandledButton) {
    toggleHandledButton.focus();
  }
}

function openHandledDialog() {
  // 该函数用于弹窗展示已处理订单，首页不再离开当前工作流。
  setHandledDialogVisible(true);
}

function closeHandledDialog() {
  // 该函数用于关闭已处理订单弹窗并回到入口按钮。
  setHandledDialogVisible(false);
}

function setActiveView(viewName) {
  const target = String(viewName || "home");
  viewButtons.forEach((button) => {
    const active = button.dataset.viewTarget === target;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.title = active ? `当前页面：${button.textContent}` : `切换到${button.textContent}`;
  });
  viewPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === target);
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.message || `请求失败：${response.status}`);
  return payload;
}

function formatFullDateTime(timestamp) {
  // 该函数用于把后台时间戳显示成完整日期，避免只看时分秒时无法判断是哪一轮。
  const value = Number(timestamp || 0);
  if (!value) return "暂无";
  const date = new Date(value * 1000);
  const timeText = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":");
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日${timeText}`;
}

function renderIndicators(runtime) {
  // 该函数把监控流程渲染成树状进度，让每一步的状态和时间戳都能直接对照。
  const steps = buildWorkflowSteps(runtime || {});
  workflowGrid.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workflow-head";
  header.innerHTML = [
    `<div class="workflow-heading">`,
    `<h2>监控进度</h2>`,
    `<p id="workflowStatusText" class="workflow-status-text">${escapeHtml(runtime.statusText || "后台状态未知")}</p>`,
    `</div>`,
    `<div class="workflow-meta">`,
    `<span>本轮处理时间：${escapeHtml(formatFullDateTime(runtime.lastScanAt))}</span>`,
    `<span>最近成功时间：${escapeHtml(formatFullDateTime(runtime.lastSuccessfulScanAt))}</span>`,
    `</div>`,
  ].join("");
  const list = document.createElement("div");
  list.className = "workflow-tree";
  steps.forEach((step) => list.appendChild(renderWorkflowStep(step)));
  workflowGrid.append(header, list);
  parkDetachedWorkflowActions();
}

function buildWorkflowSteps(runtime) {
  // 该函数兼容旧后端 indicators，新后端优先给每步独立时间戳。
  const rawSteps = Array.isArray(runtime.workflowSteps) ? runtime.workflowSteps : [];
  if (rawSteps.length) return rawSteps;
  const indicators = runtime.indicators || {};
  return indicatorOrder
    .filter((key) => indicators[key])
    .map((key) => ({ key, title: indicators[key].title, state: indicators[key].state, detail: indicators[key].detail, updated_at: 0 }));
}

function renderWorkflowStep(step) {
  // 该函数只负责渲染单个树节点，避免进度树和业务状态逻辑混在一起。
  const state = step.state || "idle";
  const item = document.createElement("article");
  item.className = `workflow-step ${state}`;
  item.innerHTML = [
    `<div class="workflow-marker"><span class="workflow-dot">${workflowStateIcon(state)}</span></div>`,
    `<div class="workflow-row">`,
    `<strong class="workflow-title">${escapeHtml(step.title || "未命名步骤")}</strong>`,
    `<span class="workflow-state ${state}">${escapeHtml(indicatorStateLabels[state] || state)}</span>`,
    `<time class="workflow-time">${escapeHtml(formatFullDateTime(step.updated_at))}</time>`,
    `</div>`,
    `<p class="workflow-detail">${escapeHtml(step.detail || "暂无说明。")}</p>`,
  ].join("");
  const actions = buildWorkflowActions(step.key);
  if (actions) item.appendChild(actions);
  return item;
}

function buildWorkflowActions(stepKey) {
  // 该函数把动作按钮挂到对应流程节点，按钮本身仍复用原有事件绑定和门禁逻辑。
  const buttons = workflowActionTargets[stepKey] || [];
  const usableButtons = buttons.filter(Boolean);
  if (!usableButtons.length) return null;
  const actions = document.createElement("div");
  actions.className = "workflow-actions";
  usableButtons.forEach((button) => actions.appendChild(button));
  return actions;
}

function parkDetachedWorkflowActions() {
  // 该函数把没有对应流程节点的按钮停回隐藏池，避免页面刷新后留下游离按钮对象。
  if (!workflowActionPool) return;
  Object.values(workflowActionTargets)
    .flat()
    .filter((button) => button && !button.isConnected)
    .forEach((button) => workflowActionPool.appendChild(button));
}

function workflowStateIcon(state) {
  if (state === "ok") return "✓";
  if (state === "running") return "•";
  if (state === "warning") return "!";
  return "";
}

function renderAppMetadata(metadata) {
  const item = metadata || {};
  const websiteText = item.official_website || "";
  const websiteUrl = item.official_website_url || "";
  const websiteHtml = websiteText && websiteUrl
    ? `<a class="app-meta-link" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(websiteText)}</a>`
    : escapeHtml(websiteText || "未配置");
  appMetaBar.innerHTML = [
    `<span class="app-meta-item">版本：${escapeHtml(item.version || "未知")}</span>`,
    `<span class="app-meta-item">作者：${escapeHtml(item.author_name || "未配置")}</span>`,
    `<span class="app-meta-item">微信：${escapeHtml(item.author_wechat || "未配置")}</span>`,
    `<span class="app-meta-item">官网：${websiteHtml}</span>`,
  ].join("");
}

function getRuntimeIndicator(runtime, key) {
  // 该函数统一读取流程状态，按钮门禁只看后台真实状态，不靠页面文字猜。
  return runtime && runtime.indicators ? runtime.indicators[key] || {} : {};
}

function isErpReady(runtime) {
  // 该函数用于判断第1步是否已经完成，未完成时不允许启动后续自动监控。
  return getRuntimeIndicator(runtime, "browser").state === "ok";
}

function isErpOpening(runtime) {
  // 该函数用于识别正在打开或等待登录的中间态，避免重复点打开 ERP 造成浏览器重启。
  return getRuntimeIndicator(runtime, "browser").state === "running" || (runtime && runtime.statusPhase === "登录中");
}

function syncMonitorButtons(runtime) {
  // 该函数把按钮状态绑定到后台真实监控状态，避免点击成功后按钮恢复原文案造成“没反应”的误判。
  const monitoring = Boolean(runtime && runtime.monitoring);
  const stopRequested = Boolean(runtime && runtime.monitorStopRequested);
  const restartRequested = Boolean(runtime && runtime.monitorRestartRequested);
  const erpReady = isErpReady(runtime);
  const erpOpening = isErpOpening(runtime);
  if (monitoring) {
    window.buttonFeedback.setButtonState(openErpButton, {
      text: "ERP已锁定",
      title: "监控运行中不能重新打开 ERP，请先停止监控。",
      state: "running",
      disabled: true,
    });
  } else if (erpOpening) {
    window.buttonFeedback.setButtonState(openErpButton, {
      text: "打开中",
      title: "正在打开 ERP 或等待登录完成。",
      state: "running",
      disabled: true,
    });
  } else {
    window.buttonFeedback.setButtonState(openErpButton, {
      text: erpReady ? "重新打开 ERP" : "打开 ERP",
      title: erpReady ? "重新打开 ERP 会刷新受控浏览器。" : "先打开 ERP 并完成登录。",
      state: "",
      disabled: false,
    });
  }
  if (monitoring && restartRequested) {
    window.buttonFeedback.setButtonState(startMonitorButton, {
      text: "重启待生效",
      title: "已收到重新开始请求，当前扫描收尾后会自动恢复监控。",
      state: "running",
      disabled: true,
    });
    window.buttonFeedback.setButtonState(stopMonitorButton, {
      text: "停止中",
      title: "正在等待当前扫描收尾。",
      state: "running",
      disabled: true,
    });
    return;
  }
  if (monitoring && stopRequested) {
    window.buttonFeedback.setButtonState(startMonitorButton, {
      text: "重新开始",
      title: "当前正在停止，点击后会在本轮扫描收尾后自动恢复监控。",
      state: "",
      disabled: false,
    });
    window.buttonFeedback.setButtonState(stopMonitorButton, {
      text: "停止中",
      title: "停止请求已发送，正在等待当前扫描收尾。",
      state: "running",
      disabled: true,
    });
    return;
  }
  if (monitoring) {
    window.buttonFeedback.setButtonState(startMonitorButton, {
      text: "监控中",
      title: "自动监控已经启动，重复点击不会启动第二份。",
      state: "running",
      disabled: true,
    });
    window.buttonFeedback.setButtonState(stopMonitorButton, {
      text: "停止监控",
      title: "停止自动监控，但保留 ERP 浏览器。",
      state: "",
      disabled: false,
    });
    return;
  }
  if (!erpReady) {
    window.buttonFeedback.setButtonState(startMonitorButton, {
      text: erpOpening ? "等待 ERP" : "先打开 ERP",
      title: "请先完成第1步：打开 ERP 并等系统检测到订单查询页。",
      state: erpOpening ? "running" : "",
      disabled: true,
    });
    window.buttonFeedback.setButtonState(stopMonitorButton, {
      text: "未启动",
      title: "自动监控未运行，无需停止。",
      state: "",
      disabled: true,
    });
    return;
  }
  window.buttonFeedback.setButtonState(startMonitorButton, {
    text: "启动监控",
    title: "ERP 已就绪，可以启动自动监控。",
    state: "",
    disabled: false,
  });
  window.buttonFeedback.setButtonState(stopMonitorButton, {
    text: "未启动",
    title: "自动监控未运行，无需停止。",
    state: "",
    disabled: true,
  });
}

function formatLatestFirstLogs(logLines) {
  // 该函数只改变前端展示顺序，后台日志原始顺序仍保持从旧到新，方便写文件和排查。
  const lines = Array.isArray(logLines) ? logLines : [];
  return lines.length ? Array.from(lines).reverse().join("\n") : "暂时还没有后台日志。";
}

function setWorkflowStatusText(message) {
  // 该函数只更新监控进度里的总状态，避免顶部和进度树出现两套监控说明。
  const workflowStatusText = document.getElementById("workflowStatusText");
  if (workflowStatusText) workflowStatusText.textContent = message || "后台状态未知";
}

function syncLogOutputs(runtime) {
  // 该函数统一刷新实时日志和弹窗日志，避免两个入口显示不同内容。
  const text = formatLatestFirstLogs(runtime && runtime.logLines);
  if (logOutput) {
    logOutput.textContent = text;
    logOutput.scrollTop = 0;
  }
  if (logDialogOutput) {
    logDialogOutput.textContent = text;
    if (!logDialog.classList.contains("hidden")) logDialogOutput.scrollTop = 0;
  }
}

function setLogDialogVisible(isVisible) {
  // 该函数统一控制日志弹窗显隐，用户不用再离开页面打开外部文件。
  if (!logDialog) return;
  logDialog.classList.toggle("hidden", !isVisible);
  logDialog.setAttribute("aria-hidden", isVisible ? "false" : "true");
  if (toggleLogButton) toggleLogButton.setAttribute("aria-expanded", isVisible ? "true" : "false");
  syncModalOpenState();
  if (isVisible) {
    copyLogFeedback.textContent = "";
    syncLogOutputs(lastRuntimeSnapshot);
    copyLogButton.focus();
  } else {
    (logDialogReturnButton || openLogButton).focus();
  }
}

function openLogDialog(triggerButton = openLogButton) {
  // 该函数用于从监控进度节点打开本次处理日志弹窗。
  logDialogReturnButton = triggerButton || openLogButton;
  setLogDialogVisible(true);
}

function closeLogDialog() {
  // 该函数用于关闭日志弹窗并回到触发按钮。
  setLogDialogVisible(false);
}

function copyTextWithTextarea(text) {
  // 该函数兼容不支持 Clipboard API 的旧浏览器环境。
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("浏览器拒绝复制到剪贴板");
}

async function copyLogToClipboard() {
  // 该函数用于把弹窗里的日志一键复制给技术，不再要求用户找本地文件。
  const text = (logDialogOutput.textContent || "").trim();
  if (!text || text === "暂时还没有后台日志。") {
    copyLogFeedback.textContent = "暂时没有可复制的日志。";
    return;
  }
  try {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (_error) {
        copied = false;
      }
    }
    if (!copied) copyTextWithTextarea(text);
    copyLogFeedback.textContent = "日志已复制。";
  } catch (error) {
    copyLogFeedback.textContent = `复制失败：${formatErrorMessage(error, "请手动选中日志复制")}`;
  }
}

function renderRuntime(runtime) {
  lastRuntimeSnapshot = runtime || {};
  renderIndicators(runtime);
  syncMonitorButtons(runtime);
  window.orderBoardModule.renderOrders(runtime.problemOrders);
  syncLogOutputs(runtime);
  document.title = `${runtime.statusPhase || "待命"}｜退款自动提醒`;
}

async function loadState() {
  const snapshot = await requestJson("/api/state", { method: "GET", headers: {} });
  renderAppMetadata(snapshot.appMetadata);
  if (!configForm.dataset.ready) {
    window.configFormModule.renderForm(configForm, snapshot.form);
    configForm.dataset.ready = "1";
  }
  if (!configuredDateRangeApplied) {
    window.orderBoardModule.setConfiguredDateRangeDays(snapshot.form && snapshot.form.payment_time_range_days);
    configuredDateRangeApplied = true;
  }
  renderRuntime(snapshot.runtime);
}

async function pollState() {
  try {
    await loadState();
    statePollFailureCount = 0;
    clearRecoveredStatePollFeedback();
  } catch (error) {
    if (backendExitRequested) return;
    statePollFailureCount += 1;
    const message = formatErrorMessage(error, "后台状态刷新失败");
    setFeedback(`后台状态刷新失败：${message}`, "error", "state-poll");
    if (statePollFailureCount >= 3) {
      setWorkflowStatusText(`后台连接异常｜${message}`);
      document.title = "连接异常｜退款自动提醒";
    }
  }
}

async function persistConfig() {
  const payload = await requestJson("/api/config/save", {
    method: "POST",
    body: JSON.stringify(window.configFormModule.collectForm(configForm)),
  });
  window.configFormModule.renderForm(configForm, payload.form);
  window.orderBoardModule.setConfiguredDateRangeDays(payload.form && payload.form.payment_time_range_days);
  configuredDateRangeApplied = true;
  setFeedback(payload.message, "success");
  if (isDialogVisible(configPanel)) setConfigFeedback(payload.message, "success");
  return payload;
}

async function runSavedAction(button, url, texts) {
  return window.buttonFeedback.runButtonAction(button, texts, async () => {
    await persistConfig();
    const payload = await requestJson(url, { method: "POST", body: "{}" });
    setFeedback(payload.message || texts.successTitle || "操作成功", "success");
    await loadState();
    return payload;
  }).catch((error) => setFeedback(error.message, "error"));
}

async function runDirectAction(button, url, texts, options = {}) {
  return window.buttonFeedback.runButtonAction(button, texts, async () => {
    const payload = await requestJson(url, { method: "POST", body: "{}" });
    setFeedback(payload.message || texts.successTitle || "操作成功", "success");
    if (options.reload !== false) await loadState();
    return payload;
  }).catch((error) => setFeedback(error.message, "error"));
}

async function requestControlExit() {
  // 该函数用于提交退出请求，兼容服务端已按请求关闭导致响应断开的正常场景。
  backendExitRequested = true;
  try {
    return await requestJson("/api/control/exit", { method: "POST", body: "{}" });
  } catch (error) {
    if (isNetworkFetchFailure(error)) {
      return { ok: true, message: "后台已退出，可以关闭这个网页。" };
    }
    backendExitRequested = false;
    throw error;
  }
}

async function exitControlCenter() {
  // 该函数用于处理退出后台按钮，退出成功后停止状态刷新而不是继续轮询旧端口。
  return window.buttonFeedback.runButtonAction(exitButton, {
    runningText: "退出中",
    successText: "已退出",
    errorText: "退出失败",
  }, async () => {
    const payload = await requestControlExit();
    markControlCenterExited(payload.message || "后台已退出，可以关闭这个网页。");
    return payload;
  }).catch((error) => setFeedback(error.message, "error"));
}

function attachButtonEvents() {
  saveButton.addEventListener("click", () => {
    window.buttonFeedback.runButtonAction(saveButton, {
      runningText: "保存中",
      successText: "已保存",
      errorText: "保存失败",
    }, persistConfig).catch((error) => {
      setFeedback(error.message, "error");
      setConfigFeedback(error.message, "error");
    });
  });
  openErpButton.addEventListener("click", () => runSavedAction(openErpButton, "/api/browser/open", {
    runningText: "打开中",
    successText: "已开始",
    errorText: "打开失败",
  }));
  startMonitorButton.addEventListener("click", () => runSavedAction(startMonitorButton, "/api/monitor/start", {
    runningText: "启动中",
    successText: "已启动",
    errorText: "启动失败",
  }));
  stopMonitorButton.addEventListener("click", () => runDirectAction(stopMonitorButton, "/api/monitor/stop", {
    runningText: "停止中",
    successText: "已停止",
    errorText: "停止失败",
  }));
  openLogButton.addEventListener("click", () => openLogDialog(openLogButton));
  toggleLogButton.addEventListener("click", () => openLogDialog(toggleLogButton));
  closeLogDialogButton.addEventListener("click", closeLogDialog);
  copyLogButton.addEventListener("click", copyLogToClipboard);
  logDialog.addEventListener("click", (event) => {
    if (event.target === logDialog) closeLogDialog();
  });
  toggleHandledButton.addEventListener("click", openHandledDialog);
  closeHandledButton.addEventListener("click", closeHandledDialog);
  handledPanel.addEventListener("click", (event) => {
    if (event.target === handledPanel) closeHandledDialog();
  });
  toggleConfigButton.addEventListener("click", openConfigDialog);
  closeConfigButton.addEventListener("click", closeConfigDialog);
  configPanel.addEventListener("click", (event) => {
    if (event.target === configPanel) closeConfigDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (isDialogVisible(configPanel)) closeConfigDialog();
    else if (isDialogVisible(handledPanel)) closeHandledDialog();
    else if (isDialogVisible(logDialog)) closeLogDialog();
  });
  exitButton.addEventListener("click", exitControlCenter);
  viewButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.viewTarget));
  });
}

window.orderBoardModule.init({
  elements: {
    orderBoard: document.getElementById("orderBoard"),
    handledBoard: document.getElementById("handledBoard"),
    orderSearchInput: document.getElementById("orderSearchInput"),
    handledSearchInput: document.getElementById("handledSearchInput"),
    clearOrderSearchButton: document.getElementById("clearOrderSearchButton"),
    clearHandledSearchButton: document.getElementById("clearHandledSearchButton"),
    orderPageSizeSelect: document.getElementById("orderPageSizeSelect"),
    handledPageSizeSelect: document.getElementById("handledPageSizeSelect"),
    dateFilterButtons: Array.from(document.querySelectorAll("[data-order-date-days]")),
    pendingOrderList: document.getElementById("pendingOrderList"),
    verifyingOrderList: document.getElementById("verifyingOrderList"),
    processingOrderList: document.getElementById("processingOrderList"),
    handledOrderList: document.getElementById("handledOrderList"),
    pendingPager: document.getElementById("pendingPager"),
    verifyingPager: document.getElementById("verifyingPager"),
    processingPager: document.getElementById("processingPager"),
    handledPager: document.getElementById("handledPager"),
    pendingCount: document.getElementById("pendingCount"),
    verifyingCount: document.getElementById("verifyingCount"),
    processingCount: document.getElementById("processingCount"),
    handledCount: document.getElementById("handledCount"),
  },
  getRuntimeSnapshot: () => lastRuntimeSnapshot,
  requestJson,
  renderRuntime,
  setFeedback,
});
attachButtonEvents();
setActiveView("home");
pollState();
statePollTimer = window.setInterval(pollState, 2000);
