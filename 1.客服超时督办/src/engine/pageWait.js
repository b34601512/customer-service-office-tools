const DEFAULT_BACKGROUND_POLLING_MS = 250;

async function waitForPageFunction(page, pageFunction, arg, options = {}) {
  // 这里统一把页面条件等待改成固定毫秒轮询，避免后台页因 raf 停摆而卡死自动化流程。
  return page.waitForFunction(pageFunction, arg, {
    polling:
      options && Object.prototype.hasOwnProperty.call(options, "polling")
        ? options.polling
        : DEFAULT_BACKGROUND_POLLING_MS,
    ...options
  });
}

module.exports = {
  DEFAULT_BACKGROUND_POLLING_MS,
  waitForPageFunction
};
