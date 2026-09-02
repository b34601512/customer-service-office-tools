function renderMeta(metadata) {
  const appName = metadata?.appName || "响应时间";
  const version = metadata?.version || "";
  const usageHistory = metadata?.usageHistory || {};
  document.title = `${appName}${version ? ` v${version}` : ""} 后台`;
  if (!appMetaBar) return;
  appMetaBar.innerHTML = "";
  const item = document.createElement("span");
  item.className = "app-meta-item version";
  item.textContent = version ? `版本：v${version}` : "版本信息未知";
  appMetaBar.appendChild(item);
  if (appMetaBar.dataset.showUsageHistory === "true") {
    const usageItem = document.createElement("span");
    usageItem.className = "app-meta-item last-used";
    usageItem.textContent = `上次使用：${usageHistory.previousUsedDateText || "暂无记录"}`;
    usageItem.title = usageHistory.currentUsedDateText ? `本次打开：${usageHistory.currentUsedDateText}` : "";
    appMetaBar.appendChild(usageItem);
  }
}

function renderWorkflow(runtime = {}) {
  if (!workflowGrid) return;
  workflowGrid.innerHTML = "";
  const header = document.createElement("div");
  header.className = "workflow-head";
  header.innerHTML = [
    `<div class="workflow-heading">`,
    `<h2>测试流程</h2>`,
    `</div>`,
    `<p id="guideHint" class="workflow-suggestion">${escapeHtml(buildGuideHint(runtime))}</p>`,
  ].join("");
  const list = document.createElement("div");
  list.className = "workflow-tree";
  buildWorkflowSteps(runtime).forEach((step) => list.appendChild(renderWorkflowStep(step)));
  workflowGrid.appendChild(header);
  workflowGrid.appendChild(list);
}

function buildWorkflowSteps(runtime = {}) {
  // 该函数把后台状态重新编排为用户真实操作流程，避免按钮和状态散落各处。
  const indicators = runtime.indicators || {};
  const phase = runtime.statusPhase || "待命";
  return [
    {
      key: "config",
      title: "确认运行配置",
      state: "ok",
      condition: "第1步",
      detail: "确认网址、账号密码、轮数和延迟参数；执行登录、启动、退出前会自动保存当前配置。",
    },
    workflowStepFromIndicator("service", indicators.service, "打开咚咚客服端", "第2步", "先打开咚咚客服端并完成登录。"),
    workflowStepFromIndicator("web", indicators.web, "打开买家客户端", "第3步", "再打开买家客户端并完成登录。"),
    workflowStepFromIndicator("browser", indicators.browser, "浏览器控制就绪", "必要状态", "两个受控浏览器都就绪后，才允许启动主流程。"),
    workflowStepFromIndicator("temp", indicators.temp, "内容引擎就绪", "必要状态", "内容引擎正常后，系统才能生成并写入测试内容。"),
    {
      key: "main",
      title: indicators.main?.title || "启动测试流程",
      state: indicators.main?.state || "idle",
      condition: phase,
      detail: indicators.main?.detail || runtime.statusText || "等待启动。",
    },
    {
      key: "logs",
      title: "日志与退出",
      state: ["已完成", "已停止"].includes(phase) ? "ok" : "idle",
      condition: "收尾",
      detail: "需要排查时看实时日志或启动日志；测试结束后退出后台会清理本工具打开的窗口。",
    },
  ];
}

function workflowStepFromIndicator(key, indicator = {}, fallbackTitle, condition, fallbackDetail) {
  return {
    key,
    title: indicator.title || fallbackTitle,
    state: indicator.state || "idle",
    condition,
    detail: indicator.detail || fallbackDetail,
  };
}

function renderWorkflowStep(step) {
  // 该函数只渲染一个流程节点，按钮挂载和状态判断都由上层函数传入。
  const state = step.state || "idle";
  const item = document.createElement("article");
  item.className = `workflow-step ${state}`;
  item.innerHTML = [
    `<div class="workflow-marker"><span class="workflow-dot">${workflowStateIcon(state)}</span></div>`,
    `<div class="workflow-row">`,
    `<strong class="workflow-title">${escapeHtml(step.title || "未命名步骤")}</strong>`,
    `<span class="workflow-state ${escapeHtml(state)}">${escapeHtml(indicatorStateLabels[state] || state)}</span>`,
    `<span class="workflow-condition">${escapeHtml(step.condition || "")}</span>`,
    `</div>`,
    `<p class="workflow-detail">${escapeHtml(step.detail || "暂无说明。")}</p>`,
  ].join("");
  const actions = buildWorkflowActions(step.key);
  if (actions) item.appendChild(actions);
  return item;
}

function buildWorkflowActions(stepKey) {
  // 该函数把已有按钮移动到对应流程节点，保证点击事件和原业务接口继续复用。
  const buttons = workflowActionTargets[stepKey] || [];
  const usableButtons = buttons.filter(Boolean);
  if (!usableButtons.length) return null;
  const actions = document.createElement("div");
  actions.className = "workflow-actions";
  usableButtons.forEach((button) => actions.appendChild(button));
  return actions;
}

function workflowStateIcon(state) {
  if (state === "ok") return "✓";
  if (state === "running") return "•";
  if (state === "warning") return "!";
  return "";
}

function renderIndicators(indicators = {}) {
  renderLegacyIndicators(indicators);
  syncLoginActionButtons(window.latestRuntime || { indicators });
}

function renderLegacyIndicators(indicators = {}) {
  if (!indicatorRow) return;
  indicatorRow.innerHTML = "";
  Object.entries(indicators).forEach(([key, indicator]) => {
    const isClickable = clickableIndicatorKeys.has(key);
    const state = indicator.state || "idle";
    const item = document.createElement(isClickable ? "button" : "div");
    item.className = `indicator-item${isClickable ? " indicator-button" : ""}`;
    if (isClickable) {
      const locked = isLoginTargetLocked(window.latestRuntime || { indicators }, key, state);
      item.type = "button";
      item.disabled = locked;
      item.dataset.locked = locked ? "true" : "false";
      item.addEventListener("click", () => openLoginTarget(key));
    }
    item.innerHTML = `<span class="indicator-dot ${state}"></span><span>${escapeHtml(indicator.title)}</span>`;
    item.addEventListener("mouseenter", () => showIndicatorTooltip(indicator.detail || "暂无明细", item));
    item.addEventListener("mousemove", (event) => moveIndicatorTooltip(event.clientX, event.clientY));
    item.addEventListener("mouseleave", hideIndicatorTooltip);
    indicatorRow.appendChild(item);
  });
}

function getLoginActionButton(target) {
  return target === "web" ? webLoginButton : serviceLoginButton;
}

function getLoginActionLabel(target) {
  return target === "web" ? "买家客户端" : "咚咚客服端";
}

function isLoginTargetLocked(runtime = {}, target, stateOverride = "") {
  // 该函数把登录按钮门禁集中到一处，避免流程树按钮和隐藏测试按钮状态不一致。
  const state = stateOverride || runtime?.indicators?.[target]?.state || "idle";
  return lockedLoginTargets.has(target) || state === "running" || isMainFlowControllable(runtime);
}

function syncLoginActionButtons(runtime = {}) {
  clickableIndicatorKeys.forEach((target) => {
    const button = getLoginActionButton(target);
    if (!button) return;
    const state = runtime?.indicators?.[target]?.state || "idle";
    const label = getLoginActionLabel(target);
    const locked = isLoginTargetLocked(runtime, target, state);
    const mainFlowRunning = isMainFlowControllable(runtime);
    button.disabled = locked;
    button.dataset.locked = locked ? "true" : "false";
    button.textContent = state === "ok" ? `重新打开${label}` : state === "running" ? `${label}打开中` : `打开${label}`;
    if (mainFlowRunning) {
      button.title = "主流程运行中不能重新打开登录页，请先停止当前测试。";
    } else if (state === "running") {
      button.title = "正在打开或等待登录完成，请不要重复点击。";
    } else if (state === "ok") {
      button.title = `${label}已就绪；如页面被手动关闭，可重新打开。`;
    } else {
      button.title = `打开${label}登录页。`;
    }
  });
}

function syncLoginTargetLocks(indicators = {}) {
  // 只用后端状态解除锁，避免点击后的本地锁被旧状态重绘误清掉。
  clickableIndicatorKeys.forEach((key) => {
    if (pendingLoginTargets.has(key)) {
      lockedLoginTargets.add(key);
      return;
    }
    const state = indicators[key]?.state || "idle";
    if (state === "running") {
      lockedLoginTargets.add(key);
    } else if (state === "idle" || state === "ok" || state === "warning" || state === "stopped") {
      lockedLoginTargets.delete(key);
    }
  });
}

function showIndicatorTooltip(detail, anchor) {
  indicatorTooltip.textContent = detail || "暂无明细";
  indicatorTooltip.classList.remove("hidden");
  const rect = anchor.getBoundingClientRect();
  moveIndicatorTooltip(rect.left + rect.width / 2, rect.bottom);
}

function moveIndicatorTooltip(x, y) {
  indicatorTooltip.style.left = `${Math.max(12, x + 14)}px`;
  indicatorTooltip.style.top = `${Math.max(12, y + 14)}px`;
}

function hideIndicatorTooltip() {
  indicatorTooltip.classList.add("hidden");
}

function isStartReady(runtime) {
  const indicators = runtime?.indicators || {};
  const coreReady = ["service", "web", "browser"].every((key) => indicators[key]?.state === "ok");
  const mainState = indicators.main?.state || "idle";
  const mainNotBlocking = mainState !== "warning" && mainState !== "running";
  return Boolean(runtime?.ready) && coreReady && mainNotBlocking;
}

function isMainFlowControllable(runtime) {
  const phase = runtime?.statusPhase || "";
  return ["启动中", "工作中", "休息中", "暂停中"].includes(phase);
}

function updateActionButtons(runtime) {
  const readyForStart = isStartReady(runtime);
  const mainFlowControllable = isMainFlowControllable(runtime);
  syncLoginActionButtons(runtime || {});
  if (startButton) {
    startButton.classList.toggle("primary", readyForStart);
    startButton.disabled = !readyForStart;
    startButton.title = readyForStart ? "两个端都已登录成功，可以启动。" : "请先完成咚咚客服端和买家客户端登录，两个端都变绿后才能启动。";
  }
  if (pauseButton) {
    pauseButton.disabled = !mainFlowControllable;
    pauseButton.title = mainFlowControllable ? "主流程运行中，可以暂停或继续。" : "主流程未运行，不能暂停或继续。";
  }
  if (stopButton) {
    stopButton.disabled = !mainFlowControllable;
    stopButton.title = mainFlowControllable ? "主流程运行中，可以停止。" : "主流程未运行，不能停止。";
  }
}

function buildGuideHint(runtime) {
  const phase = runtime?.statusPhase || "";
  const indicators = runtime?.indicators || {};
  const coreReady = ["service", "web", "browser"].every((key) => indicators[key]?.state === "ok");
  if (runtime?.loginRunning) {
    return "当前建议：先在两个独立浏览器里完成登录，等三个关键状态点都变绿。";
  }
  if (isStartReady(runtime)) {
    return "当前建议：三个关键状态都已就绪，可以点「启动」或按 F8 开始；如手动关了浏览器，可再点对应状态按钮重开。";
  }
  if (phase === "工作中" || phase === "休息中" || phase === "启动中" || phase === "切换中") {
    return "当前建议：主流程运行中，可按 F8 暂停/继续，按 F9 停止。";
  }
  if (phase === "已完成" || phase === "停止中" || phase === "已停止") {
    return "当前建议：如果测试已经结束，点「退出后台」即可自动清理本工具打开的窗口。";
  }
  if (coreReady) {
    return "当前建议：关键窗口已经到位，下一步直接点「启动」即可。";
  }
  return "当前建议：先点下方两个登录按钮分别打开网页登录页。";
}
