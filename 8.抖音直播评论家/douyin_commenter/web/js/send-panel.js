// 该文件用于维护发送评论面板，统一手动发送和评论库按最少发送次数倒计时发送。
function getEnabledCommentItems() {
  // 该函数用于从当前配置里取可发送评论，避免自动模式抽到空内容或停用内容。
  const comments = Array.isArray(latestForm?.comments) ? latestForm.comments : [];
  return comments.filter((item) => item.enabled && String(item.text || "").trim());
}

function pickLeastSentCommentItem() {
  // 该函数用于选择发送次数最少的启用评论，简单轮询避免长期重复同一句。
  const comments = getEnabledCommentItems();
  if (!comments.length) throw new Error("评论库没有启用评论，请先点顶部评论库维护。");
  const minSentCount = Math.min(...comments.map((item) => Number(item.sent_count || 0)));
  const selected = comments.find((item) => Number(item.sent_count || 0) === minSentCount) || comments[0];
  selectedLibraryCommentId = selected.id || "";
  selectedLibraryCommentText = String(selected.text || "").trim();
  return selected;
}

function setRandomCountdownMessage(message, state = "idle") {
  // 该函数用于在发送面板内反馈倒计时状态，避免用户不知道系统正在等什么。
  if (!randomCountdownText) return;
  randomCountdownText.textContent = message || "";
  randomCountdownText.dataset.state = state;
}

function getRandomCountdownSeconds() {
  // 该函数用于读取配置里的随机评论倒计时，旧配置没有该字段时默认 30 秒。
  const value = Number(latestForm?.schedule?.random_countdown_seconds || 30);
  return Math.max(1, Math.floor(value || 30));
}

function isTaskLimitReached() {
  // 该函数用于从后端运行态判断总工作任务是否完成，前端只负责停止继续触发。
  return Boolean(latestRuntime?.taskLimitReached);
}

function getTaskLimitMessage() {
  // 该函数用于生成总任务完成提示，文案跟后端进度保持一致。
  return `${latestRuntime?.taskProgressText || "总工作任务已完成"}，请在运行配置里调大总任务数后再继续。`;
}

function clearRandomCountdownTimer(options = {}) {
  // 该函数用于停止前端倒计时，只清理页面定时器，不影响后台浏览器。
  if (randomSendTimerId !== null) {
    window.clearInterval(randomSendTimerId);
    randomSendTimerId = null;
  }
  randomSendRemainingSeconds = 0;
  if (!options.keepSelectedComment) {
    selectedLibraryCommentId = "";
    selectedLibraryCommentText = "";
  }
  if (cancelRandomButton) cancelRandomButton.hidden = true;
}

function cancelRandomCountdown(message = "已停止随机倒计时。") {
  // 该函数用于用户切回手动或点击停止时取消随机倒计时。
  clearRandomCountdownTimer();
  setRandomCountdownMessage(message, "idle");
}

function updateRandomCountdownText() {
  // 该函数用于刷新配置确认倒计时，倒计时结束后自动发送当前输入框内容。
  if (randomSendRemainingSeconds <= 0) {
    clearRandomCountdownTimer({ keepSelectedComment: true });
    sendCurrentComment({ fromCountdown: true });
    return;
  }
  setRandomCountdownMessage(`已填入发送次数最少的评论，${randomSendRemainingSeconds} 秒后自动发送当前输入框内容。`, "running");
}

function startRandomCountdown() {
  // 该函数用于按发送次数最少选择评论并启动配置倒计时，给用户留出检查和取消时间。
  try {
    if (isTaskLimitReached()) {
      if (manualModeInput) manualModeInput.checked = true;
      clearRandomCountdownTimer();
      const message = getTaskLimitMessage();
      setRandomCountdownMessage(message, "idle");
      setFeedback(message, "success");
      return;
    }
    clearRandomCountdownTimer();
    const comment = pickLeastSentCommentItem();
    manualCommentInput.value = comment.text;
    randomSendRemainingSeconds = getRandomCountdownSeconds();
    if (cancelRandomButton) cancelRandomButton.hidden = false;
    updateRandomCountdownText();
    randomSendTimerId = window.setInterval(() => {
      randomSendRemainingSeconds -= 1;
      updateRandomCountdownText();
    }, 1000);
  } catch (error) {
    if (manualModeInput) manualModeInput.checked = true;
    setRandomCountdownMessage(error.message, "error");
    setFeedback(error.message, "error");
  }
}

function handleSendModeChange() {
  // 该函数用于根据单选按钮切换发送方式，评论库模式一选中就取最少发送次数评论并倒计时。
  if (randomModeInput?.checked) {
    startRandomCountdown();
    return;
  }
  cancelRandomCountdown("手动输入后点击立即发送。");
}

function sendCurrentComment(options = {}) {
  // 该函数用于发送输入框当前内容，并在评论库自动模式下持续进入下一轮。
  const text = String(manualCommentInput?.value || "").trim();
  const commentId = selectedLibraryCommentId && text === selectedLibraryCommentText ? selectedLibraryCommentId : "";
  const shouldContinueRandomAfterSuccess = Boolean(randomModeInput?.checked);
  if (!options.fromCountdown) {
    clearRandomCountdownTimer();
    setRandomCountdownMessage("正在发送当前输入框内容。", "running");
  }
  if (!text) {
    setRandomCountdownMessage("评论内容为空，请先输入或选择评论库自动填入。", "error");
    setFeedback("评论内容为空，请先输入或选择评论库自动填入。", "error");
    return;
  }
  if (isTaskLimitReached()) {
    const message = getTaskLimitMessage();
    clearRandomCountdownTimer();
    if (manualModeInput) manualModeInput.checked = true;
    setRandomCountdownMessage(message, "idle");
    setFeedback(message, "success");
    return;
  }
  runAction(
    sendNowButton,
    "正在发送评论。",
    () => requestJson("/api/actions/send-now", { method: "POST", body: JSON.stringify({ text, comment_id: commentId }) }),
    (payload) => {
      if (payload.form) latestForm = payload.form;
      if (payload.runtime) renderRuntime(payload.runtime);
      selectedLibraryCommentId = "";
      selectedLibraryCommentText = "";
      renderSummary(latestForm);
      setWorkflowStep(3);
      if ((payload.runtime || latestRuntime)?.taskLimitReached) {
        if (manualModeInput) manualModeInput.checked = true;
        setRandomCountdownMessage(getTaskLimitMessage(), "idle");
        return;
      }
      if (shouldContinueRandomAfterSuccess && randomModeInput?.checked) {
        startRandomCountdown();
        return;
      }
      if (manualModeInput) manualModeInput.checked = true;
      setRandomCountdownMessage("评论已发送。", "idle");
    },
    (error) => {
      setRandomCountdownMessage(error.message, "error");
    }
  );
}
