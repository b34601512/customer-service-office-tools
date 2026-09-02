// 该文件用于切换配置中心页面并加载初始配置。
function showConfigPage(pageName = "hub") {
  // 这里只切换配置弹窗里的页面，不改变任何保存接口和配置数据结构。
  if (!configModal) {
    return;
  }

  const normalizedPageName = CONFIG_PAGE_META[pageName] ? pageName : "hub";
  configModal.querySelectorAll("[data-config-page]").forEach((pageElement) => {
    pageElement.classList.toggle("hidden", pageElement.dataset.configPage !== normalizedPageName);
  });

  const meta = CONFIG_PAGE_META[normalizedPageName];
  if (configModalTitle) {
    configModalTitle.textContent = meta.title;
  }
  if (configModalSubtitle) {
    configModalSubtitle.textContent = meta.subtitle;
  }
}

async function loadConfigInitialState() {
  // 这里统一加载配置页首屏数据，保证打开页面就能直接看到当前真实配置。
  const [stateResult, privateConfigResult] = await Promise.all([
    requestJson("/api/state", { method: "GET" }),
    requestJson("/api/private-config", { method: "GET" })
  ]);
  fillConfig(stateResult.config);
  fillWecomConfig(privateConfigResult.wecomRobot);
  setConfigFeedback("生产配置已加载。", false, {
    type: "info",
    title: "配置就绪",
    showToast: false
  });
  setSectionFeedback(privateConfigFeedback, "企微提醒配置已加载。", false, {
    type: "info",
    title: "配置就绪",
    showToast: false
  });
}
