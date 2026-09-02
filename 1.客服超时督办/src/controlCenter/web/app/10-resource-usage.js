// 该文件用于渲染资源占用弹窗，首页其它逻辑不直接拼资源 HTML。
function formatResourceBytes(bytes, fallbackText = "") {
  // 这里把资源接口的字节数转成短文本，接口返回文本时优先使用接口文本。
  if (fallbackText) {
    return fallbackText;
  }

  const normalizedBytes = Math.max(0, Number(bytes) || 0);
  if (normalizedBytes >= 1024 * 1024 * 1024) {
    return `${(normalizedBytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (normalizedBytes >= 1024 * 1024) {
    return `${(normalizedBytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.round(normalizedBytes / 1024)} KB`;
}

function formatResourceCpuPercent(value) {
  // 这里统一 CPU 百分比显示，避免接口异常值污染页面。
  const percent = Number(value);
  return Number.isFinite(percent) ? `${percent.toFixed(1)}%` : "-";
}

function renderResourceUsageLoading() {
  // 这里在采样期间给用户明确反馈，避免按钮点击后像没反应。
  if (resourceUsageUpdatedAt) {
    resourceUsageUpdatedAt.textContent = "正在采样";
  }
  if (resourceUsageSummary) {
    resourceUsageSummary.innerHTML = `
      <div class="resource-summary-item">
        <span>状态</span>
        <strong>正在读取</strong>
      </div>
    `;
  }
  if (resourceUsageProcessList) {
    resourceUsageProcessList.innerHTML = `<div class="empty-state">正在读取资源占用。</div>`;
  }
}

function renderResourceUsageError(message) {
  // 这里把资源采集失败展示在弹窗内，让用户不用去日志页才能知道失败。
  if (resourceUsageUpdatedAt) {
    resourceUsageUpdatedAt.textContent = "读取失败";
  }
  if (resourceUsageSummary) {
    resourceUsageSummary.innerHTML = `
      <div class="resource-summary-item resource-summary-item-error">
        <span>状态</span>
        <strong>读取失败</strong>
      </div>
    `;
  }
  if (resourceUsageProcessList) {
    resourceUsageProcessList.innerHTML = `<div class="empty-state">${escapeHtml(message || "资源占用读取失败。")}</div>`;
  }
}

function renderResourceUsage(resources = {}) {
  // 这里渲染本项目进程树资源占用，首页只负责展示后端采样结果。
  const processes = Array.isArray(resources.processes) ? resources.processes : [];
  const processGroups = Array.isArray(resources.processGroups) ? resources.processGroups : [];
  const displayItems = processGroups.length > 0
    ? processGroups
    : processes.map((processInfo) => ({
      role: processInfo.role || processInfo.name || "项目进程",
      name: processInfo.name || "unknown",
      pid: processInfo.pid,
      detailText: `${processInfo.name || "unknown"}｜PID ${processInfo.pid}`,
      cpuPercent: processInfo.cpuPercent,
      memoryWorkingSetBytes: processInfo.memoryWorkingSetBytes,
      memoryWorkingSetText: processInfo.memoryWorkingSetText,
      processCount: 1
    }));
  if (resourceUsageUpdatedAt) {
    resourceUsageUpdatedAt.textContent = resources.capturedAt ? formatScanTime(new Date(resources.capturedAt).getTime()) : "刚刚采样";
  }
  if (resourceUsageSummary) {
    resourceUsageSummary.innerHTML = `
      <div class="resource-summary-item">
        <span>CPU</span>
        <strong>${escapeHtml(formatResourceCpuPercent(resources.cpuPercent))}</strong>
      </div>
      <div class="resource-summary-item">
        <span>内存</span>
        <strong>${escapeHtml(formatResourceBytes(resources.memoryWorkingSetBytes, resources.memoryWorkingSetText))}</strong>
      </div>
      <div class="resource-summary-item">
        <span>运行项</span>
        <strong>${escapeHtml(resources.processGroupCount ?? displayItems.length)}</strong>
      </div>
      <div class="resource-summary-item">
        <span>技术进程</span>
        <strong>${escapeHtml(resources.processCount ?? processes.length)}</strong>
      </div>
    `;
  }
  if (!resourceUsageProcessList) {
    return;
  }
  if (displayItems.length === 0) {
    resourceUsageProcessList.innerHTML = `<div class="empty-state">当前没有采集到项目进程。</div>`;
    return;
  }

  resourceUsageProcessList.innerHTML = displayItems.map((processInfo) => `
    <article class="resource-process-row">
      <div class="resource-process-main">
        <strong>${escapeHtml(processInfo.role || processInfo.name || "项目进程")}</strong>
        <span>${escapeHtml(processInfo.detailText || `${processInfo.name || "unknown"}｜PID ${processInfo.pid}`)}</span>
      </div>
      <div class="resource-process-metric">
        <span>CPU</span>
        <strong>${escapeHtml(formatResourceCpuPercent(processInfo.cpuPercent))}</strong>
      </div>
      <div class="resource-process-metric">
        <span>内存</span>
        <strong>${escapeHtml(formatResourceBytes(processInfo.memoryWorkingSetBytes, processInfo.memoryWorkingSetText))}</strong>
      </div>
    </article>
  `).join("");
}
