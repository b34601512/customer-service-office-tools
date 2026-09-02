// 该文件用于绑定首页配置弹窗并启动配置脚本。
function setConfigModalVisible(isVisible) {
  // 这里统一控制配置弹窗显隐，避免多个入口直接改 class 后状态不一致。
  if (!configModal) {
    return;
  }

  configModal.classList.toggle("hidden", !isVisible);
  configModal.setAttribute("aria-hidden", isVisible ? "false" : "true");
  refreshModalOpenState();
  if (openConfigModalButton) {
    openConfigModalButton.setAttribute("aria-expanded", isVisible ? "true" : "false");
  }
}

async function ensureConfigModalLoaded() {
  // 这里延迟加载配置，首页打开时先展示主流程，用户点配置时再读取低频配置。
  if (configModalHasLoaded) {
    return;
  }

  await loadConfigInitialState();
  configModalHasLoaded = true;
}

async function openConfigModal() {
  // 这里打开配置弹窗并加载最新配置，避免主管看到旧表单误保存。
  configModalTriggerButton = document.activeElement;
  setConfigModalVisible(true);
  showConfigPage("hub");
  setConfigFeedback("配置正在加载，请稍候。", false, {
    type: "pending",
    title: "正在加载",
    showToast: false
  });
  try {
    await ensureConfigModalLoaded();
    if (closeConfigModalButton) {
      closeConfigModalButton.focus();
    }
  } catch (error) {
    setConfigFeedback(error.message, true, {
      title: "配置加载失败"
    });
  }
}

function closeConfigModal() {
  // 这里关闭配置弹窗并把焦点还给触发按钮，键盘操作不会丢位置。
  setConfigModalVisible(false);
  if (configModalTriggerButton && typeof configModalTriggerButton.focus === "function") {
    configModalTriggerButton.focus();
  } else if (openConfigModalButton) {
    openConfigModalButton.focus();
  }
}

function bindConfigModalActions() {
  // 这里只绑定弹窗自己的打开关闭行为，表单保存仍走原配置逻辑。
  if (!configModal || !openConfigModalButton || !closeConfigModalButton) {
    return;
  }

  openConfigModalButton.addEventListener("click", () => {
    openConfigModal();
  });

  closeConfigModalButton.addEventListener("click", closeConfigModal);
  configModal.addEventListener("click", (event) => {
    if (event.target === configModal) {
      closeConfigModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (isKeywordAddModalVisible()) {
      return;
    }
    if (event.key === "Escape" && !configModal.classList.contains("hidden")) {
      closeConfigModal();
    }
  });
}

bindConfigModalActions();
bindConfigActions();

if (!configModal) {
  loadConfigInitialState().catch((error) => {
    setSectionFeedback(configFeedback, error.message, true, {
      title: "页面初始化失败"
    });
  });
}
