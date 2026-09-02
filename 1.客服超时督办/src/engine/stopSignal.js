const { log } = require("./logger");

function createStopState() {
  // 这里统一接管停止信号，让后台轮询能平滑退出而不是中途硬断。
  const state = {
    stopped: false
  };

  const handleStop = (signal) => {
    state.stopped = true;
    log("主线:停止", "停止控制", "接收信号", `收到停止信号：${signal}`);
  };

  process.on("SIGINT", handleStop);
  process.on("SIGTERM", handleStop);

  return {
    state,
    dispose() {
      process.off("SIGINT", handleStop);
      process.off("SIGTERM", handleStop);
    }
  };
}

module.exports = {
  createStopState
};
