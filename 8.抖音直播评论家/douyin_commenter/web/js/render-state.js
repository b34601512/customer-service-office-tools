// 该文件用于把后端快照渲染到首页流程和日志弹窗。
function renderMeta(appMetadata = {}) {
  // 该函数用于展示应用名称和版本。
  metaText.textContent = `${appMetadata.appName || "抖音直播评论员"}｜${appMetadata.version || "未知版本"}`;
}

function renderSummary(form) {
  // 该函数用于刷新流程配置状态，具体配置值只放在配置弹窗里。
  document.getElementById("workflowSummary1").textContent = enabledCommentCount(form) > 0 ? "配置弹窗维护" : "需要检查配置";
  document.getElementById("workflowSummary3").textContent = latestRuntime?.taskProgressText || "总工作任务 0/500";
  autoAdvanceWorkflowStep();
}

function renderLogLines(lines) {
  // 该函数用于刷新弹窗里的运行日志，首页不直接铺开日志。
  if (!Array.isArray(lines)) return;
  logOutput.textContent = lines.length ? lines.join("\n") : "暂时还没有运行日志。";
  logOutput.scrollTop = logOutput.scrollHeight;
}

function appendLogLine(line) {
  // 该函数用于追加一行实时日志，并限制弹窗内容长度避免长期运行卡顿。
  const current = logOutput.textContent === "暂时还没有运行日志。" || logOutput.textContent === "日志加载中" ? [] : logOutput.textContent.split("\n");
  current.push(line);
  logOutput.textContent = current.slice(-300).join("\n");
  logOutput.scrollTop = logOutput.scrollHeight;
}

function renderRuntime(runtime = {}) {
  // 该函数用于刷新运行状态、按钮状态和实时日志。
  latestRuntime = runtime || {};
  const activePage = runtime.activePage || {};
  const activePageLabel = activePage.title || activePage.url || "未打开";
  const lastCommentLabel = runtime.lastComment ? `最近评论：${runtime.lastComment}` : "暂无发送记录";
  const taskProgressLabel = runtime.taskProgressText || "总工作任务 0/500";
  activePageText.textContent = activePageLabel;
  lastCommentText.textContent = lastCommentLabel;
  taskProgressText.textContent = taskProgressLabel;
  workflowStatusText.textContent = runtime.statusText || "后台状态未知";
  document.getElementById("workflowSummary2").textContent = activePageLabel;
  document.getElementById("workflowSummary3").textContent = taskProgressLabel;
  renderLogLines(runtime.logLines);
  autoAdvanceWorkflowStep();
}

function renderState(snapshot) {
  // 该函数用于把后端快照同步到首页和配置弹窗草稿。
  latestForm = snapshot.form || latestForm || {};
  renderMeta(snapshot.appMetadata || {});
  renderSummary(latestForm);
  renderRuntime(snapshot.runtime || {});
}
