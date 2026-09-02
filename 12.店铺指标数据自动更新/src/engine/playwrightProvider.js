function loadPlaywrightCore() {
  // 这里只从当前项目依赖加载 Playwright，避免依赖别的项目 node_modules 导致生产环境不可复现。
  try {
    return require("playwright-core");
  } catch (error) {
    throw new Error(
      `当前项目缺少 playwright-core 依赖，请在项目根目录执行 npm install 后重试。原始错误：${error.message}`
    );
  }
}

module.exports = {
  loadPlaywrightCore
};
