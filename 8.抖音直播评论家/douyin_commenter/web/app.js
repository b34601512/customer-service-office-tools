// 该文件用于绑定页面入口事件并启动前端控制台。
bindClick(configButton, openConfigModal);
bindClick(commentLibraryButton, openCommentModal);
bindClick(configCloseButton, closeConfigModal);
bindClick(configCancelButton, closeConfigModal);
bindClick(commentCloseButton, closeCommentModal);
bindClick(commentCancelButton, closeCommentModal);
bindClick(addRoomButton, addRoomDraft);
bindClick(addAccountButton, addAccountDraft);
bindClick(addCommentButton, openAddCommentModal);
bindClick(importCommentButton, openCommentImportPicker);
bindClick(addCommentCloseButton, closeAddCommentModal);
bindClick(addCommentCancelButton, closeAddCommentModal);
bindClick(saveNewCommentButton, saveNewCommentDraft);
bindClick(saveConfigButton, saveConfig);
bindClick(saveCommentButton, saveComments);
if (manualModeInput) manualModeInput.addEventListener("change", handleSendModeChange);
if (randomModeInput) randomModeInput.addEventListener("change", handleSendModeChange);
if (commentImportFileInput) commentImportFileInput.addEventListener("change", importSelectedCommentFile);
if (importSplitMode) importSplitMode.addEventListener("change", renderCommentImportMode);
document.querySelectorAll("[data-workflow-step]").forEach((button) => {
  button.addEventListener("click", () => setWorkflowStep(Number(button.dataset.workflowStep)));
});

bindClick(openRoomButton, () => runAction(openRoomButton, "正在打开直播间。", () => requestJson("/api/actions/open-room", { method: "POST", body: "{}" }), () => setWorkflowStep(3)));
bindClick(sendNowButton, () => sendCurrentComment());
bindClick(cancelRandomButton, () => {
  if (manualModeInput) manualModeInput.checked = true;
  cancelRandomCountdown();
});
bindClick(openLogButton, openLogModal);
bindClick(logCloseButton, closeLogModal);
bindClick(copyLogButton, copyLogToClipboard);
bindClick(openLogFileButton, () => runAction(openLogFileButton, "正在打开日志文件。", () => requestJson("/api/actions/open-log", { method: "POST", body: "{}" })));
bindClick(exitButton, () => runAction(exitButton, "正在退出后台。", () => requestJson("/api/control/exit", { method: "POST", body: "{}" })));

if (configModal) {
  configModal.addEventListener("click", (event) => {
    if (event.target === configModal) closeConfigModal();
  });
}

if (commentModal) {
  commentModal.addEventListener("click", (event) => {
    if (event.target === commentModal) closeCommentModal();
  });
}

if (addCommentModal) {
  addCommentModal.addEventListener("click", (event) => {
    if (event.target === addCommentModal) closeAddCommentModal();
  });
}

if (logModal) {
  logModal.addEventListener("click", (event) => {
    if (event.target === logModal) closeLogModal();
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !addCommentModal.classList.contains("hidden")) {
    closeAddCommentModal();
    return;
  }
  if (event.key === "Escape" && !configModal.classList.contains("hidden")) {
    closeConfigModal();
  }
  if (event.key === "Escape" && !commentModal.classList.contains("hidden")) {
    closeCommentModal();
  }
  if (event.key === "Escape" && !logModal.classList.contains("hidden")) {
    closeLogModal();
  }
});

requestJson("/api/state", { method: "GET", headers: {} })
  .then((snapshot) => {
    renderState(snapshot);
    connectEvents();
  })
  .catch((error) => setFeedback(error.message, "error"));
