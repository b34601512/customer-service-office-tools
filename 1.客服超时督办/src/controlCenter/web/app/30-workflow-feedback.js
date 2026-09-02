// 该文件用于刷新首页流程节点和用户动作反馈。
function setWorkflowStep(stepKey, state, options = {}) {
  // 这里统一刷新树状流程节点，避免每个渲染函数各自拼状态文本。
  const refs = workflowSteps[stepKey];
  if (!refs || !refs.item) {
    return;
  }

  const normalizedState = state || "idle";
  refs.item.classList.remove("idle", "ok", "running", "warning");
  refs.item.classList.add(normalizedState);
  if (refs.state) {
    refs.state.className = `workflow-state ${normalizedState}`;
    refs.state.textContent = options.stateText || WORKFLOW_STATE_LABELS[normalizedState] || normalizedState;
  }
  if (refs.time) {
    refs.time.textContent = options.timeText || "暂无";
  }
  if (refs.detail) {
    refs.detail.textContent = options.detailText || refs.detail.textContent;
  }
}

function resolveTaskWorkflowState(task, targetTaskName) {
  // 这里把后端任务状态转换成流程树状态，页面只展示用户能理解的阶段。
  if (targetTaskName === "login" && task?.awaitingConfirmation) {
    return {
      state: "warning",
      stateText: "等确认",
      timeText: formatDuration(task.startedAt),
      detailText: task.message || "请先完成浏览器登录，再点击完成登录。"
    };
  }

  if (!task || task.status === "idle") {
    if (targetTaskName === "login") {
      return resolveLoginStatusWorkflowState();
    }

    return {
      state: "idle",
      stateText: targetTaskName === "start" ? "待启动" : "待操作",
      timeText: targetTaskName === "start" ? "未运行" : "需要时执行",
      detailText:
        targetTaskName === "start"
          ? "启动后会同时监控「超时待回复」「客户转接」「漏回复」「下班监控」，任务日志进入独立日志页。"
          : "第一次使用或登录态失效时执行，完成登录后回到这里确认。"
    };
  }

  if (task.taskName !== targetTaskName) {
    if (targetTaskName === "login") {
      return resolveLoginStatusWorkflowState();
    }

    return {
      state: "idle",
      stateText: targetTaskName === "start" ? "待启动" : "待操作",
      timeText: targetTaskName === "start" ? "未运行" : "需要时执行"
    };
  }

  if (task.status === "failed") {
    return {
      state: "warning",
      stateText: "异常",
      timeText: task.endedAt || "刚刚结束",
      detailText: task.message || "任务异常结束，请打开实时日志查看原因。"
    };
  }

  if (task.status === "stopping") {
    return {
      state: "running",
      stateText: "停止中",
      timeText: formatDuration(task.startedAt),
      detailText: task.message || "正在停止当前任务。"
    };
  }

  if (task.awaitingConfirmation) {
    return {
      state: "warning",
      stateText: "等确认",
      timeText: formatDuration(task.startedAt),
      detailText: task.message || "请先完成浏览器登录，再点击完成登录。"
    };
  }

  return {
    state: "running",
    stateText: "运行中",
    timeText: formatDuration(task.startedAt),
    detailText: task.message || "任务正在运行。"
  };
}

function resolveLoginStatusWorkflowState() {
  // 这里把最近一次真实登录态验证结果映射到第一步，只有已验证有效才显示绿色。
  if (latestLoginStatus?.isValid) {
    return {
      state: "ok",
      stateText: "已登录",
      timeText: latestLoginStatus.verifiedAt || "已验证",
      detailText: latestLoginStatus.detail || "登录记录已验证有效，可以直接后台启动。"
    };
  }

  if (latestLoginStatus?.status === "invalid") {
    return {
      state: "warning",
      stateText: "需登录",
      timeText: latestLoginStatus.verifiedAt || "已失效",
      detailText: latestLoginStatus.detail || "登录记录已失效，请重新执行首次登录。"
    };
  }

  return {
    state: "idle",
    stateText: "待操作",
    timeText: "尚未验证",
    detailText: "第一次使用或登录态失效时执行，完成登录后回到这里确认。"
  };
}

function showFeedbackToast(message, type = "success", options = {}) {
  // 这里补一个右上角浮层提示，避免用户没注意到页面中部反馈条。
  const meta = FEEDBACK_TYPE_META[type] || FEEDBACK_TYPE_META.info;
  const toast = document.createElement("section");
  toast.className = `feedback-toast ${meta.className}`;
  toast.dataset.toastId = `feedback-toast-${Date.now()}-${(feedbackToastSerial += 1)}`;
  toast.innerHTML = `
    <strong class="feedback-toast-title">${escapeHtml(options.title || meta.title)}</strong>
    <p class="feedback-toast-message">${escapeHtml(message)}</p>
  `;
  feedbackStack.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  }, options.durationMs || (type === "error" ? 5000 : 2800));
}

function setWorkflowFeedback(stepKey, message, type = "info", options = {}) {
  // 这里把操作反馈写回对应流程节点，避免首页再放一块重复的独立反馈卡片。
  if (!stepKey || !workflowSteps[stepKey]) {
    workflowStatusText.textContent = String(message || "");
    return;
  }

  const normalizedType = type || "info";
  const meta = FEEDBACK_TYPE_META[normalizedType] || FEEDBACK_TYPE_META.info;
  setWorkflowStep(stepKey, FEEDBACK_WORKFLOW_STATES[normalizedType] || "idle", {
    stateText: options.title || meta.title,
    timeText: options.timeText || "刚刚",
    detailText: String(message || "")
  });
}

function setFeedback(message, isError = false, options = {}) {
  // 这里统一收口首页反馈，任务动作写入流程节点，系统级异常写入流程标题。
  const type = options.type || (isError ? "error" : "success");
  setWorkflowFeedback(options.workflowStep, message, type, options);
  if (options.showToast ?? !options.silent) {
    showFeedbackToast(message, type, options);
  }
}

function setButtonBusy(button, pendingText) {
  // 这里统一切换按钮的处理中态，避免用户重复点击。
  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add("is-busy");
  button.dataset.originalText = originalText;
  button.textContent = pendingText;
}

function clearButtonBusy(button, fallbackText = "") {
  // 这里统一恢复按钮文本和可点击状态，确保动作结束后界面回到稳定态。
  const originalText = button.dataset.originalText || fallbackText || button.textContent;
  button.disabled = false;
  button.classList.remove("is-busy");
  button.textContent = originalText;
  delete button.dataset.originalText;
}

function renderRuntimeDuration() {
  // 这里单独刷新流程步骤里的运行时长，让首页数字稳定更新，不依赖日志事件驱动。
  if (latestDashboardSnapshot) {
    renderCountdownModal(latestDashboardSnapshot);
  }

  if (!currentTask || (currentTask.status !== "running" && currentTask.status !== "stopping")) {
    return;
  }

  const durationText = formatDuration(currentTask.startedAt);
  if (currentTask.taskName === "login") {
    setWorkflowStep("login", resolveTaskWorkflowState(currentTask, "login").state, {
      ...resolveTaskWorkflowState(currentTask, "login"),
      timeText: durationText
    });
  }
  if (currentTask.taskName === "start") {
    setWorkflowStep("start", resolveTaskWorkflowState(currentTask, "start").state, {
      ...resolveTaskWorkflowState(currentTask, "start"),
      timeText: durationText
    });
  }
}

function renderDashboard(dashboard) {
  // 这里统一渲染首页状态，客户明细只进弹窗，避免首页和弹窗重复显示。
  latestDashboardSnapshot = dashboard || {};
  const monitorSummary = dashboard.monitorSummary || {};
  const latestRecord = dashboard.latestRecord || null;
  const hasMonitorSummary = Boolean(monitorSummary.hasData);
  const hasLatestRecord = Boolean(latestRecord && latestRecord.customerName && latestRecord.customerName !== "暂无");

  monitorUpdatedAtValue.textContent = monitorSummary.updatedAtText || "暂无";
  renderCountdownModal(dashboard);
  refreshCountdownAttentionBadge(dashboard);

  if (!latestRecord || latestRecord.customerName === "暂无") {
    setWorkflowStep("result", "idle", {
      stateText: "待查看",
      timeText: "独立页面",
      detailText: "实时日志可在独立页面查看，客服绩效请使用终端「7 报表」。"
    });
  } else {
    setWorkflowStep("result", "ok", {
      stateText: "有记录",
      timeText: latestRecord.occurredAt || "已生成",
      detailText: `最近处理：${latestRecord.customerName}｜${latestRecord.statusLabel}`
    });
  }

  if (!hasMonitorSummary) {
    setWorkflowStep("monitor", "idle", {
      stateText: "等待数据",
      timeText: "暂无判定",
      detailText: monitorSummary.detailText || "后台启动后，这里显示最近一次真实客户判定。"
    });
    return;
  }

  setWorkflowStep("monitor", Number(monitorSummary.attentionCount || 0) > 0 ? "warning" : "ok", {
    stateText: monitorSummary.stateText || "已判定",
    timeText: monitorSummary.updatedAtText || "刚刚",
    detailText: hasLatestRecord
      ? `最近动作：${latestRecord.customerName}｜${latestRecord.statusLabel}`
      : monitorSummary.detailText || "后台已完成客户判定。"
  });
}
