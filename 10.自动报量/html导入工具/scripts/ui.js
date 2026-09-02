// 该文件用于管理下载链接、进度条、结果指标和页面日志反馈。
function createDownload(bytes, fileName) {
  // 该函数用于生成浏览器下载链接，让客服手动保存导出的报量表。
  if (pageState.downloadUrl) URL.revokeObjectURL(pageState.downloadUrl);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  pageState.downloadUrl = URL.createObjectURL(blob);
  const link = document.getElementById("downloadLink");
  link.href = pageState.downloadUrl;
  link.download = fileName;
  link.textContent = "点击下载导出的报量表";
  link.classList.remove("hidden");
}

function buildOutputFileName(inputName, targetDate, mode) {
  // 该函数用于生成带日期的输出文件名，避免覆盖原始模板。
  const baseName = inputName.replace(/\.xlsx$/i, "");
  const stamp = new Date();
  const timeText = `${String(stamp.getHours()).padStart(2, "0")}${String(stamp.getMinutes()).padStart(2, "0")}`;
  const modeText = buildOutputDateText(targetDate, mode);
  return `${baseName}-已导入-${modeText}-${timeText}.xlsx`;
}

function buildOutputDateText(targetDate, mode) {
  // 该函数用于把导入范围写进文件名；本月到今天用0115这种短日期段，客服看文件更直观。
  if (mode === "day") return targetDate;
  if (mode === "monthToToday") return `${targetDate.slice(0, 7)}-01${targetDate.slice(8, 10)}`;
  return `${targetDate.slice(0, 7)}整月`;
}

function initializeWorkflow() {
  // 该函数用于初始化5个流程节点，让主界面只保留一套树状流程状态。
  pageState.currentWorkflowStep = 1;
  updateWorkflowStateFromInputs();
  setWorkflowStep(1);
}

function setWorkflowStep(stepNumber) {
  // 该函数用于展开当前流程节点，并关闭其他节点内容，避免所有操作一次性挤在页面上。
  const normalizedStep = Math.max(1, Math.min(5, Number(stepNumber) || 1));
  if (normalizedStep >= 4 && document.getElementById("targetDateInput").value) {
    completeWorkflowStep(3);
  }
  pageState.currentWorkflowStep = normalizedStep;
  if (normalizedStep !== 3) closeCalendarPopup();
  document.querySelectorAll("[data-workflow-item]").forEach((item) => {
    const step = Number(item.dataset.workflowItem);
    const isExpanded = step === normalizedStep;
    item.classList.toggle("expanded", isExpanded);
    const button = item.querySelector("[data-workflow-step]");
    if (button) button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  });
  updateWorkflowReview();
  renderWorkflowState();
}

function renderWorkflowState() {
  // 该函数把每个流程节点的状态点和状态文字统一刷新，避免页面出现两套状态判断。
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

function getWorkflowVisualState(stepNumber) {
  // 该函数只负责把内部集合转换成界面状态，业务完成条件仍由各流程动作维护。
  if (pageState.workflowWarningSteps.has(stepNumber)) return "warning";
  if (pageState.workflowCompletedSteps.has(stepNumber)) return "ok";
  if (stepNumber === pageState.currentWorkflowStep) return "active";
  return "idle";
}

function getWorkflowIcon(stepNumber, visualState) {
  // 该函数让状态点直接表达结果，减少用户靠文字判断当前卡在哪一步。
  if (visualState === "ok") return "✓";
  if (visualState === "warning") return "!";
  if (visualState === "active") return "•";
  return String(stepNumber);
}

function getWorkflowStateLabel(stepNumber, visualState) {
  // 该函数集中维护流程节点文案，避免同一个状态在不同位置叫法不一致。
  if (visualState === "ok") return "已完成";
  if (visualState === "warning") return "需处理";
  if (visualState === "active") return stepNumber === 4 && pageState.currentProgressPercent > 0 ? "进行中" : "当前";
  return ["", "待选择", "待选择", "待确认", "待运行", "待完成"][stepNumber] || "待处理";
}

function handleTemplateFileChange() {
  // 该函数用于选择模板后自动展开CSV节点，减少重复点击。
  updateWorkflowStateFromInputs();
  if (document.getElementById("templateFileInput").files[0]) setWorkflowStep(2);
}

function handleCsvFileChange() {
  // 该函数用于选择CSV后自动展开日期节点。
  updateWorkflowStateFromInputs();
  if (document.getElementById("csvFileInput").files[0]) setWorkflowStep(3);
}

function completeWorkflowStep(stepNumber) {
  // 该函数用于标记流程节点完成，同时清理该节点上的错误状态。
  pageState.workflowCompletedSteps.add(stepNumber);
  pageState.workflowWarningSteps.delete(stepNumber);
  renderWorkflowState();
}

function clearWorkflowStep(stepNumber) {
  // 该函数用于清理流程节点结果，避免换输入后旧结果继续显示为完成。
  pageState.workflowCompletedSteps.delete(stepNumber);
  pageState.workflowWarningSteps.delete(stepNumber);
  renderWorkflowState();
}

function updateWorkflowStateFromInputs() {
  // 该函数根据文件、日期和结果刷新流程树摘要，所有节点状态都从真实控件读取。
  const templateFile = document.getElementById("templateFileInput").files[0];
  const csvFile = document.getElementById("csvFileInput").files[0];
  const targetDate = document.getElementById("targetDateInput").value;
  const hasDownload = !document.getElementById("downloadLink").classList.contains("hidden");
  const resultNotice = document.getElementById("resultNotice");
  const resultFailed = resultNotice && resultNotice.classList.contains("error");
  const dateSummary = targetDate ? describeImportRange(targetDate, pageState.mode) : "未选择日期";

  setWorkflowCompletion(1, Boolean(templateFile));
  setWorkflowCompletion(2, Boolean(csvFile));
  setWorkflowCompletion(3, Boolean(targetDate));
  setWorkflowCompletion(5, hasDownload);

  document.getElementById("templateFileSummary").textContent = templateFile ? `已选择：${templateFile.name}` : "未选择模板";
  document.getElementById("csvFileSummary").textContent = csvFile ? `已选择：${csvFile.name}` : "未选择CSV";
  document.getElementById("workflowDateSummary").textContent = dateSummary;
  document.getElementById("workflowTemplateMeta").textContent = templateFile ? `模板：${templateFile.name}` : "模板：未选择";
  document.getElementById("workflowCsvMeta").textContent = csvFile ? `CSV：${csvFile.name}` : "CSV：未选择";
  document.getElementById("workflowDateMeta").textContent = `日期：${dateSummary}`;
  document.getElementById("workflowRunSummary").textContent = templateFile && csvFile && targetDate ? "可以开始导入" : "等待前置节点";
  document.getElementById("workflowResultSummary").textContent = hasDownload ? "可以下载结果" : resultFailed ? "导入失败" : "等待导入完成";
  updateWorkflowReview();
  renderWorkflowState();
}

function setWorkflowCompletion(stepNumber, isCompleted) {
  // 该函数用于按条件同步节点完成状态，避免重复写add/delete判断。
  if (isCompleted) {
    pageState.workflowCompletedSteps.add(stepNumber);
    pageState.workflowWarningSteps.delete(stepNumber);
  } else {
    pageState.workflowCompletedSteps.delete(stepNumber);
  }
}

function updateWorkflowReview() {
  // 该函数用于刷新导入前确认信息，让用户开始前能核对自己选了什么。
  const templateFile = document.getElementById("templateFileInput").files[0];
  const csvFile = document.getElementById("csvFileInput").files[0];
  const targetDate = document.getElementById("targetDateInput").value;
  document.getElementById("reviewTemplateName").textContent = templateFile ? templateFile.name : "未选择";
  document.getElementById("reviewCsvName").textContent = csvFile ? csvFile.name : "未选择";
  document.getElementById("reviewDateText").textContent = targetDate ? describeImportRange(targetDate, pageState.mode) : "未选择";
}

function markWorkflowImportSuccess() {
  // 该函数用于导入成功后自动展开结果节点，并把运行和结果节点标绿。
  completeWorkflowStep(4);
  completeWorkflowStep(5);
  setWorkflowStep(5);
}

function markWorkflowImportFailure() {
  // 该函数用于导入失败后展开结果节点，并把需要处理的节点标红。
  clearWorkflowStep(4);
  clearWorkflowStep(5);
  pageState.workflowWarningSteps.add(4);
  pageState.workflowWarningSteps.add(5);
  setWorkflowStep(5);
}

function updateMetrics(totalRows, aggregation, writeResult) {
  // 该函数用于刷新页面上的结果数字，让客服知道本次导入处理了多少数据。
  document.getElementById("metricTotalRows").textContent = formatNumber(totalRows);
  document.getElementById("metricValidRows").textContent = formatNumber(aggregation.validRows);
  document.getElementById("metricWrittenQty").textContent = formatNumber(writeResult.writtenQuantity);
  document.getElementById("metricUnmatched").textContent = formatNumber(aggregation.unmatchedRows);
}

function renderDetailLog(aggregation, writeResult) {
  // 该函数用于输出本次导入明细，重点展示过滤原因和异常样例。
  const lines = [];
  lines.push(`写入数量：${formatNumber(writeResult.writtenQuantity)}`);
  lines.push(`产品汇总数量：${formatNumber(writeResult.productTotalQuantity)}`);
  lines.push(`产品汇总销售额：${formatNumber(writeResult.productTotalAmount)}`);
  lines.push(`店铺汇总组：${formatNumber(writeResult.summaryGroupCount)}`);
  lines.push("");
  lines.push("过滤原因：");
  if (aggregation.skippedByReason.size === 0) {
    lines.push("  无");
  } else {
    for (const [reason, count] of aggregation.skippedByReason) {
      lines.push(`  ${reason}：${formatNumber(count)}`);
    }
  }
  if (aggregation.duplicateHitExamples.length > 0) {
    lines.push("");
    lines.push("重复映射提示：");
    aggregation.duplicateHitExamples.forEach((item) => lines.push(`  ${item}`));
  }
  if (aggregation.unmatchedExamples.length > 0) {
    lines.push("");
    lines.push("未匹配样例：");
    aggregation.unmatchedExamples.forEach((item) => lines.push(`  ${item}`));
  }
  appendDetailLog(lines.join("\n"));
}

function clearResult() {
  // 该函数用于清理上一次运行结果，避免新旧日志混在一起。
  if (pageState.downloadUrl) URL.revokeObjectURL(pageState.downloadUrl);
  pageState.downloadUrl = "";
  pageState.stepCount = 0;
  document.getElementById("downloadLink").classList.add("hidden");
  document.getElementById("detailLog").textContent = "";
  document.getElementById("copyLogFeedback").textContent = "";
  document.getElementById("stepList").textContent = "";
  setLogButtonEnabled(false);
  setResultNotice("idle", "等待导入", "导入完成后，这里会提示下一步。");
  clearWorkflowStep(4);
  clearWorkflowStep(5);
  updateWorkflowStateFromInputs();
  updateMetrics(0, { validRows: 0, unmatchedRows: 0 }, { writtenQuantity: 0 });
}

function appendDetailLog(text) {
  // 该函数用于追加详细日志，日志默认放在弹窗里，避免客服误认为页面报错。
  const log = document.getElementById("detailLog");
  log.textContent = log.textContent ? `${log.textContent}\n${text}` : text;
  setLogButtonEnabled(Boolean(log.textContent.trim()));
}

function openLogView() {
  // 该函数用于打开处理日志弹窗，只在需要排查差异或失败原因时查看。
  document.getElementById("copyLogFeedback").textContent = "";
  setLogDialogVisible(true);
  const copyButton = document.getElementById("copyLogButton");
  (copyButton.disabled ? document.getElementById("closeLogButton") : copyButton).focus();
}

function closeLogView() {
  // 该函数用于关闭处理日志弹窗并回到结果区。
  setLogDialogVisible(false);
  document.getElementById("openLogButton").focus();
}

function setLogDialogVisible(isVisible) {
  // 该函数用于统一控制日志弹窗显隐，避免直接展示日志造成误解。
  const panel = document.getElementById("logPanel");
  panel.classList.toggle("hidden", !isVisible);
  panel.setAttribute("aria-hidden", isVisible ? "false" : "true");
  document.body.classList.toggle("modal-open", isVisible);
}

function closeLogWhenClickOutside(event) {
  // 该函数用于点击遮罩关闭日志弹窗。
  if (event.target === document.getElementById("logPanel")) {
    closeLogView();
  }
}

function closeLogWhenPressEscape(event) {
  // 该函数用于按Esc关闭日志弹窗，保持所有弹窗操作习惯一致。
  if (event.key === "Escape" && !document.getElementById("logPanel").classList.contains("hidden")) {
    closeLogView();
  }
}

function setLogButtonEnabled(isEnabled) {
  // 该函数用于日志为空时禁用按钮，避免客服点开空弹窗。
  document.getElementById("openLogButton").disabled = !isEnabled;
  document.getElementById("copyLogButton").disabled = !isEnabled;
}

async function copyLogToClipboard() {
  // 该函数用于一键复制完整处理日志，方便客服直接把故障诊断发给技术。
  const text = document.getElementById("detailLog").textContent.trim();
  const feedback = document.getElementById("copyLogFeedback");
  if (!text) {
    feedback.textContent = "没有可复制的报错信息。";
    return;
  }
  try {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        copied = false;
      }
    }
    if (!copied) {
      copyTextWithTextarea(text);
    }
    feedback.textContent = "已复制，可以直接粘贴发给技术。";
  } catch (error) {
    feedback.textContent = `复制失败：${error.message || String(error)}。请手动选中下方日志复制。`;
  }
}

function copyTextWithTextarea(text) {
  // 该函数用于兼容不支持Clipboard API的旧浏览器或file协议页面。
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

function showImportRunningNotice() {
  // 该函数用于导入开始时告诉客服程序正在处理，不需要做下一步。
  setResultNotice("running", "正在导入", "请等待进度条走完，完成后这里会出现下载按钮。");
}

function showImportSuccessNotice(fileName) {
  // 该函数用于导入成功后给出明确下一步，避免客服不知道下载按钮在哪里。
  setResultNotice("success", "导入成功", `下一步：点击右侧绿色按钮下载「${fileName}」。`);
}

function showImportFailureNotice(message) {
  // 该函数用于导入失败后把失败状态和排查入口说清楚。
  setResultNotice("error", "导入失败", `${message} 请点“查看处理日志”，复制【故障诊断】整段发给技术。`);
}

function setResultNotice(state, title, message) {
  // 该函数用于统一刷新结果状态卡片，让成功、失败、等待状态一眼可见。
  const notice = document.getElementById("resultNotice");
  notice.className = `result-notice ${state}`;
  document.getElementById("resultTitle").textContent = title;
  document.getElementById("resultMessage").textContent = message;
  const resultSummary = document.getElementById("workflowResultSummary");
  if (resultSummary) resultSummary.textContent = title;
  const statusText = document.getElementById("workflowStatusText");
  if (statusText) statusText.textContent = state === "idle" ? "等待选择文件" : title;
}

function setProgress(percent, text) {
  // 该函数用于刷新进度条和当前动作说明，让长时间处理不再像卡住。
  const boundedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  pageState.currentProgressPercent = boundedPercent;
  pageState.currentProgressText = text;
  document.getElementById("statusText").textContent = text;
  document.getElementById("progressPercent").textContent = `${boundedPercent}%`;
  document.getElementById("progressBar").style.width = `${boundedPercent}%`;
  const workflowStatusText = document.getElementById("workflowStatusText");
  if (workflowStatusText) workflowStatusText.textContent = text;
  const runSummary = document.getElementById("workflowRunSummary");
  if (runSummary) runSummary.textContent = boundedPercent > 0 ? `${boundedPercent}%｜${text}` : "等待前置节点";
  renderWorkflowState();
}

function addStep(text, status) {
  // 该函数用于记录关键动作节点，保留清晰的人类可读处理轨迹。
  pageState.stepCount += 1;
  const item = document.createElement("div");
  item.className = `step-item ${status || ""}`;
  const dot = document.createElement("span");
  dot.className = "step-dot";
  const label = document.createElement("span");
  label.textContent = `${pageState.stepCount}. ${text}`;
  item.append(dot, label);
  document.getElementById("stepList").appendChild(item);
}

function setFatalStatus(message) {
  // 该函数用于显示无法继续运行的页面级错误。
  setProgress(100, message);
  addStep(message, "error");
  document.getElementById("runButton").disabled = true;
}
