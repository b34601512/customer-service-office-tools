// 该文件用于维护运行流程树的展开、完成和自动推进状态。
function setWorkflowStep(stepNumber) {
  // 该函数用于展开一个流程节点，让首页按步骤看，不把所有操作挤在一起。
  currentWorkflowStep = Math.max(1, Math.min(3, Number(stepNumber) || 1));
  document.querySelectorAll("[data-workflow-item]").forEach((item) => {
    const step = Number(item.dataset.workflowItem);
    const isExpanded = step === currentWorkflowStep;
    item.classList.toggle("expanded", isExpanded);
    const button = item.querySelector("[data-workflow-step]");
    if (button) button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  });
  renderWorkflowState();
}

function getWorkflowVisualState(stepNumber) {
  // 该函数用于把后端运行快照转换成流程树状态，不在前端另造一套业务真相。
  const runtime = latestRuntime || {};
  const hasForm = Boolean(latestForm);
  const hasComments = enabledCommentCount(latestForm) > 0;
  const activePage = runtime.activePage || {};
  const hasOpenedRoom = Boolean(activePage.url || activePage.title);
  const hasLastComment = Boolean(runtime.lastComment);
  const hasError = Boolean(runtime.lastError);
  if (stepNumber === 1) return hasForm && hasComments ? "ok" : "warning";
  if (stepNumber === 2) return hasOpenedRoom ? "ok" : currentWorkflowStep === 2 ? "active" : "idle";
  if (stepNumber === 3) {
    if (!hasComments) return "warning";
    if (hasError) return "warning";
    if (runtime.taskLimitReached) return "ok";
    return hasLastComment || currentWorkflowStep === 3 ? "active" : "idle";
  }
  return "idle";
}

function isWorkflowStepCompleted(stepNumber) {
  // 该函数用于判断某一步是否已经具备进入下一步的真实条件。
  const runtime = latestRuntime || {};
  const activePage = runtime.activePage || {};
  if (stepNumber === 1) return Boolean(latestForm) && enabledCommentCount(latestForm) > 0;
  if (stepNumber === 2) return Boolean(activePage.url || activePage.title);
  if (stepNumber === 3) return Boolean(runtime.taskLimitReached);
  return false;
}

function getSuggestedWorkflowStep() {
  // 该函数用于从当前真实状态推导下一步应该展开的位置。
  const runtime = latestRuntime || {};
  const activePage = runtime.activePage || {};
  if (runtime.lastError) return 3;
  if (!isWorkflowStepCompleted(1)) return 1;
  if (!activePage.url && !activePage.title) return 2;
  return 3;
}

function autoAdvanceWorkflowStep() {
  // 该函数用于在上一步完成后自动展开下一步，但不干扰用户手动回看。
  const suggestedStep = getSuggestedWorkflowStep();
  if (suggestedStep > currentWorkflowStep && isWorkflowStepCompleted(currentWorkflowStep)) {
    setWorkflowStep(suggestedStep);
    return;
  }
  renderWorkflowState();
}

function getWorkflowStateLabel(stepNumber, visualState) {
  // 该函数用于集中维护流程节点状态文案，避免同一状态出现多个叫法。
  if (visualState === "ok") return "已完成";
  if (visualState === "warning") return "需处理";
  if (visualState === "active" && stepNumber === 3 && Number(latestRuntime?.completedTaskCount || 0) > 0) return "进行中";
  if (visualState === "active") return "当前";
  return ["", "待检查", "待打开", "待发送"][stepNumber] || "待处理";
}

function getWorkflowIcon(stepNumber, visualState) {
  // 该函数用于让流程圆点直接表达结果，减少用户读文字的负担。
  if (visualState === "ok") return "✓";
  if (visualState === "warning") return "!";
  if (visualState === "active") return "•";
  return String(stepNumber);
}

function renderWorkflowState() {
  // 该函数用于刷新流程树每个节点的视觉状态和简短摘要。
  document.querySelectorAll("[data-workflow-item]").forEach((item) => {
    const step = Number(item.dataset.workflowItem);
    const visualState = getWorkflowVisualState(step);
    item.classList.remove("idle", "ok", "active", "warning");
    item.classList.add(visualState);
    const dot = item.querySelector(".workflow-dot");
    if (dot) dot.textContent = getWorkflowIcon(step, visualState);
    const stateLabel = document.getElementById(`workflowState${step}`);
    if (stateLabel) {
      stateLabel.className = `workflow-state ${visualState}`;
      stateLabel.textContent = getWorkflowStateLabel(step, visualState);
    }
  });
}
