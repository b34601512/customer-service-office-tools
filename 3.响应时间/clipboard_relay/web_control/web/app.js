bindClick(saveButton, async () => {
  try {
    const payload = await saveFullConfig();
    setFeedback(payload.message, "success");
    setConfigDialogFeedback(payload.message, "success");
  } catch (error) {
    setFeedback(error.message, "error");
    setConfigDialogFeedback(error.message, "error");
  }
});

bindClick(configButton, openConfigDialog);
bindClick(configCloseButton, closeConfigDialog);
bindClick(configCancelButton, closeConfigDialog);
bindClick(serviceLoginButton, () => openLoginTarget("service"));
bindClick(webLoginButton, () => openLoginTarget("web"));

bindClick(startButton, async () => {
  try {
    const payload = await requestJson("/api/control/start", { method: "POST", body: "{}" });
    setFeedback(payload.message, "success");
  } catch (error) {
    setFeedback(error.message, "error");
  }
});

bindClick(pauseButton, async () => {
  try {
    const payload = await requestJson("/api/control/pause", { method: "POST", body: "{}" });
    setFeedback(payload.message, "success");
  } catch (error) {
    setFeedback(error.message, "error");
  }
});

bindClick(stopButton, async () => {
  try {
    const payload = await requestJson("/api/control/stop", { method: "POST", body: "{}" });
    setFeedback(payload.message, "success");
  } catch (error) {
    setFeedback(error.message, "error");
  }
});

bindClick(openLogButton, async () => {
  try {
    const payload = await requestJson("/api/actions/open-startup-log", { method: "POST", body: "{}" });
    setFeedback(payload.message, "success");
  } catch (error) {
    setFeedback(error.message, "error");
  }
});

bindClick(exitButton, async () => {
  try {
    setFeedback("正在保存配置并退出后台。", "info");
    await saveFullConfig();
    const payload = await requestJson("/api/control/exit", { method: "POST", body: "{}" });
    setFeedback(payload.message, "success");
    setTimeout(() => window.close(), 700);
  } catch (error) {
    setFeedback(error.message, "error");
  }
});

bindClick(buyerUrlCloseButton, closeBuyerUrlDialog);
bindClick(buyerUrlCancelButton, closeBuyerUrlDialog);
bindClick(buyerUrlAddButton, addBuyerUrlRow);
bindClick(buyerUrlApplyButton, applyBuyerUrlDialog);
bindClick(credentialCloseButton, closeCredentialDialog);
bindClick(credentialCancelButton, closeCredentialDialog);
bindClick(credentialAddButton, addCredentialRow);
bindClick(credentialApplyButton, applyCredentialDialog);
if (configPanel) {
  configPanel.addEventListener("click", closeConfigDialogFromBackdrop);
}
if (typeof document.addEventListener === "function") {
  document.addEventListener("keydown", closeConfigDialogOnEscape);
}
if (buyerUrlOverlay) {
  buyerUrlOverlay.addEventListener("click", (event) => {
    if (event.target === buyerUrlOverlay) {
      closeBuyerUrlDialog();
    }
  });
}
if (credentialOverlay) {
  credentialOverlay.addEventListener("click", (event) => {
    if (event.target === credentialOverlay) {
      closeCredentialDialog();
    }
  });
}

loadState()
  .then(() => {
    connectEvents();
    openInitialDialogFromPath();
  })
  .catch((error) => setFeedback(error.message, "error"));
