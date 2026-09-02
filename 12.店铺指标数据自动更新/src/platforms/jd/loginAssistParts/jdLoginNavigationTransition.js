const { wait } = require("../../../shared/browserActionEngine");

function isJdLoginNavigationTransitionError(error) {
  // 登录页重定向会销毁旧页面上下文；这表示状态已变化，不是采集失败。
  return /Execution context was destroyed, most likely because of a navigation/i.test(
    String(error?.message || error || "")
  );
}

async function runJdLoginStateStep(action, options = {}) {
  // 这里只在登录状态机边界接住已确认的页面跳转瞬态，其他读取故障仍原样暴露。
  try {
    return {
      completed: true,
      value: await action()
    };
  } catch (error) {
    if (!isJdLoginNavigationTransitionError(error)) {
      throw error;
    }

    const waitFn = options.waitFn || wait;
    const transitionWaitMs = Math.max(1, Number(options.transitionWaitMs) || 100);
    await waitFn(transitionWaitMs);
    return {
      completed: false,
      transitionMessage: String(error?.message || error)
    };
  }
}

module.exports = {
  isJdLoginNavigationTransitionError,
  runJdLoginStateStep
};
