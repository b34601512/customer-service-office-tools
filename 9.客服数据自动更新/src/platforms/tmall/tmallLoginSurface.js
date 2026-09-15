// 天猫登录面定位：页面/框架在登录跳转瞬间会销毁执行上下文，定位失败必须按“暂未找到”交回上层轮询，
// 不能把竞态当成整店失败（对齐京东 isLoginSurfaceRaceError 的处理方式）。
function isTmallLoginSurfaceRaceError(error) {
  // 这个函数只识别“处理登录面时页面已经跳走”的竞态错误。
  const message = String(error?.message || "");
  return /Timeout \d+ms exceeded|not attached|detached|Execution context was destroyed|Target closed|Target page, context or browser has been closed/i.test(
    message
  );
}

async function findFirstVisibleLocator(frame, selectors) {
  // 这个函数只挑选登录面里第一个可见输入或按钮；页面跳走时按“暂未找到”返回 null。
  for (const selector of selectors) {
    try {
      const locator = frame.locator(selector).first();
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        return locator;
      }
    } catch (error) {
      if (isTmallLoginSurfaceRaceError(error)) {
        return null;
      }
      throw error;
    }
  }
  return null;
}

module.exports = {
  isTmallLoginSurfaceRaceError,
  findFirstVisibleLocator
};
