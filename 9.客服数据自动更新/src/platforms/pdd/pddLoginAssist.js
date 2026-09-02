// 该文件用于解决拼多多登录辅助线程调度和对外接口汇总问题。
const { createRestartableAssistRunner } = require("../../shared/restartableAssistRunner");
const { log, logError } = require("../../engine/logger");
const assistRunner = require("./loginAssistParts/pddLoginAssistRunner");

const loginAssistRunner = createRestartableAssistRunner(async (assistTask, options = {}) => {
  try {
    await assistRunner.runPddLoginAssist(assistTask, options);
  } catch (error) {
    logError("主线:失败", "拼多多登录", "自动填充", error);
  }
});

function startPddLoginAssist(options = {}) {
  // 这里允许重新打开窗口时强制重启辅助线程，确保每次都从当前店铺登录页重新处理。
  const forceRestart = Boolean(options.forceRestart);
  if (forceRestart && loginAssistRunner.isRunning()) {
    log("主线:执行", "拼多多登录", "自动填充重启", "检测到重新打开登录窗口，准备中断上一轮辅助线程并启动新流程");
  }

  return loginAssistRunner.start(assistRunner.buildPddLoginAssistRunnerOptions(options));
}

function stopPddLoginAssist() {
  // 这里给切店重置运行态使用，上一店辅助线程必须立刻失效，不能继续碰新店浏览器。
  loginAssistRunner.cancel();
}

module.exports = {
  startPddLoginAssist,
  stopPddLoginAssist
};
