function renderRuntime(runtime) {
  window.latestRuntime = runtime || {};
  if (statusText) {
    statusText.textContent = runtime.statusText || "后台状态未知";
  }
  syncLoginTargetLocks(runtime.indicators || {});
  renderIndicators(runtime.indicators || {});
  renderWorkflow(runtime || {});
  updateActionButtons(runtime || {});
  if (guideHint) {
    guideHint.textContent = buildGuideHint(runtime || {});
  }
  if (logOutput) {
    logOutput.textContent = Array.isArray(runtime.logLines) && runtime.logLines.length > 0 ? runtime.logLines.join("\n") : "暂时还没有后台日志。";
  }
}

async function loadState() {
  const snapshot = await requestJson("/api/state", { method: "GET", headers: {} });
  renderMeta(snapshot.appMetadata);
  renderForm(snapshot.form);
  renderRuntime(snapshot.runtime);
}

function connectEvents() {
  const source = new EventSource("/api/events");
  source.addEventListener("log", (event) => {
    if (!logOutput) return;
    const payload = JSON.parse(event.data);
    const current = logOutput.textContent === "暂时还没有后台日志。" ? [] : logOutput.textContent.split("\n");
    current.push(payload.line);
    logOutput.textContent = current.slice(-300).join("\n");
    logOutput.scrollTop = logOutput.scrollHeight;
  });
  source.addEventListener("state", (event) => {
    renderRuntime(JSON.parse(event.data));
  });
}
