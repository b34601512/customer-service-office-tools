function waitForProcessExit(child, timeoutMs = 5000) {
  // 这里等待子进程真实退出，避免旧登录任务的退出事件覆盖新启动的后台任务状态。
  return new Promise((resolve) => {
    if (!child || child.exitCode !== undefined && child.exitCode !== null) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once("exit", finish);
    child.once("close", finish);
  });
}

module.exports = {
  waitForProcessExit
};
