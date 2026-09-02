// 该文件用于解决京东登录辅助子模块加载和对外接口注册问题。
const { createRestartableAssistRunner } = require("../../shared/restartableAssistRunner");
const { log } = require("../../engine/logger");
const {
  buildJdLoginAssistRunnerOptions,
  runJdLoginAssist
} = require("./loginAssistParts/jdLoginAssistRunner");

const loginAssistRunner = createRestartableAssistRunner(runJdLoginAssist);

function startJdLoginAssist(options = {}) {
  // 这里允许重新打开窗口时强制重启辅助线程，避免用户手工关掉浏览器后二次打开还被上一轮线程占住。
  const forceRestart = Boolean(options.forceRestart);
  if (forceRestart && loginAssistRunner.isRunning()) {
    log("主线:执行", "京东登录", "自动填充重启", "检测到重新打开登录窗口，准备中断上一轮辅助线程并启动新流程");
  }

  return loginAssistRunner.start(buildJdLoginAssistRunnerOptions(options));
}

function stopJdLoginAssist() {
  // 这里给切店重置运行态使用，上一店辅助线程必须立刻失效，不能继续抢占新店浏览器。
  loginAssistRunner.cancel();
}

module.exports = {
  startJdLoginAssist,
  stopJdLoginAssist
};
