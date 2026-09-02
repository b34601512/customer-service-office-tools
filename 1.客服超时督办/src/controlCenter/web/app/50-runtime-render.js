// 该文件用于渲染后台任务、登录态、接口请求和实时刷新。
function renderTask(task) {
  // 这里统一渲染当前任务状态，避免按钮和状态区各自猜测流程阶段。
  currentTask = task;
  const loginWorkflowState = resolveTaskWorkflowState(task, "login");
  const startWorkflowState = resolveTaskWorkflowState(task, "start");
  setWorkflowStep("login", loginWorkflowState.state, loginWorkflowState);
  setWorkflowStep("start", startWorkflowState.state, startWorkflowState);

  if (!task || task.status === "idle") {
    workflowStatusText.textContent = task?.message || "控制台已就绪。";
    confirmLoginButton.classList.add("hidden");
    stopTaskButton.classList.remove("hidden");
    stopTaskButton.disabled = false;
    stopTaskButton.textContent = "退出控制台";
    renderRuntimeDuration();
    return;
  }

  workflowStatusText.textContent = task.message || task.label || "后台任务运行中。";
  if (task.awaitingConfirmation) {
    confirmLoginButton.textContent = task.taskName === "start" ? "完成登录并继续" : "完成登录";
    confirmLoginButton.classList.remove("hidden");
  } else {
    confirmLoginButton.classList.add("hidden");
  }

  stopTaskButton.classList.remove("hidden");
  stopTaskButton.disabled = task.status === "stopping" || task.taskName !== "start";
  stopTaskButton.textContent = task.status === "stopping" ? "正在退出" : (task.taskName === "start" ? "停止并退出" : "退出控制台");
  renderRuntimeDuration();
}

function renderLoginStatus(loginStatus) {
  // 这里刷新最近登录态验证结果，第一步是否变绿只看后端明确返回的状态。
  latestLoginStatus = loginStatus || null;
  const loginWorkflowState = resolveTaskWorkflowState(currentTask, "login");
  setWorkflowStep("login", loginWorkflowState.state, loginWorkflowState);
}

// requestJson 由 /shared/requestJson.js 提供，与 viewer/logs/settings 共用同一份实现（issue #551）。

async function loadInitialState() {
  // 这里统一加载首屏数据，保证页面一打开就能看到状态和最近结果。
  const data = await requestJson("/api/state", { method: "GET" });
  renderLoginStatus(data.loginStatus);
  renderTask(data.runtime.currentTask);
  renderDashboard(data.dashboard);
}

async function refreshDashboard(silent = true) {
  // 这里单独轮询状态面板，保证首页数字持续更新，但不把普通轮询日志塞进网页。
  try {
    const data = await requestJson("/api/dashboard", { method: "GET" });
    renderLoginStatus(data.loginStatus);
    renderDashboard(data.dashboard);
  } catch (error) {
    if (!silent) {
      throw error;
    }
  }
}

function startLiveRefresh() {
  // 这里统一启动页面内的轻量级刷新器，只更新状态面板和流程时间，不制造滚动噪声。
  if (!durationRefreshTimer) {
    durationRefreshTimer = window.setInterval(() => {
      renderRuntimeDuration();
    }, 1000);
  }

  if (!dashboardRefreshTimer) {
    dashboardRefreshTimer = window.setInterval(() => {
      refreshDashboard(true);
    }, 3000);
  }
}
