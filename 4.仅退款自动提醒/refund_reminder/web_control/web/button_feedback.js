(() => {
  const timers = new WeakMap();

  function rememberButton(button) {
    // 该函数用于保留按钮原始状态，临时反馈结束后能恢复到用户熟悉的文案。
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent || "";
    if (!button.dataset.originalTitle) button.dataset.originalTitle = button.title || "";
  }

  function clearButtonTimer(button) {
    const timer = timers.get(button);
    if (timer) window.clearTimeout(timer);
    timers.delete(button);
  }

  function restoreButton(button) {
    rememberButton(button);
    button.textContent = button.dataset.originalText || "";
    button.title = button.dataset.originalTitle || "";
    button.dataset.state = "";
    button.disabled = button.dataset.restoreDisabled === "true";
    delete button.dataset.restoreDisabled;
  }

  function setButtonState(button, options = {}) {
    // 该函数把动作反馈直接写到按钮上，长文本放进 title 供悬停查看。
    if (!button) return;
    rememberButton(button);
    clearButtonTimer(button);
    if (button.dataset.restoreDisabled === undefined) button.dataset.restoreDisabled = button.disabled ? "true" : "false";
    if (options.text !== undefined) button.textContent = String(options.text || "");
    if (options.title !== undefined) button.title = String(options.title || "");
    button.dataset.state = options.state || "";
    if (options.disabled !== undefined) button.disabled = Boolean(options.disabled);
    if (options.timeout) {
      timers.set(button, window.setTimeout(() => restoreButton(button), Number(options.timeout)));
    }
  }

  async function runButtonAction(button, options, action) {
    setButtonState(button, {
      text: options.runningText || "处理中",
      title: options.runningTitle || options.runningText || "处理中",
      state: "running",
      disabled: true,
    });
    try {
      const payload = await action();
      const message = payload && payload.message ? payload.message : options.successTitle || options.successText || "操作成功";
      setButtonState(button, {
        text: typeof options.successText === "function" ? options.successText(payload) : options.successText || "已完成",
        title: message,
        state: "success",
        disabled: false,
        timeout: options.timeout || 2600,
      });
      return payload;
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "操作失败");
      setButtonState(button, {
        text: options.errorText || "失败",
        title: message,
        state: "error",
        disabled: false,
        timeout: options.errorTimeout || 4200,
      });
      throw error;
    }
  }

  window.buttonFeedback = {
    restoreButton,
    runButtonAction,
    setButtonState,
  };
})();
