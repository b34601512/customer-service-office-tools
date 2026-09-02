// 该文件用于解决京东登录辅助任务中断判断和页面文本读取的问题。
const { log } = require("../../../engine/logger");

function shouldStopJdLoginAssist(assistTask, displayName) {
  // 这里在每轮处理前确认自己还是最新任务，过期任务会立刻退出，避免二次打开窗口时卡死。
  if (assistTask?.isCurrent()) {
    return false;
  }

  log("主线:中断", "京东登录", "自动填充", `店铺「${displayName}」检测到新的打开窗口请求，上一轮登录辅助流程已停止`);
  return true;
}

module.exports = {
  shouldStopJdLoginAssist
};
