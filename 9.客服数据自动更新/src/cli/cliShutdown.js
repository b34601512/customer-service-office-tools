const {
  cleanRuntimeBrowserCachesWhenSafe,
  cleanRuntimeDownloadRunsWhenSafe
} = require("../config/runtimeLayoutService");
const { closeManagedChrome } = require("../engine/chromeSession");
const { stopJdLoginAssist } = require("../platforms/jd/jdLoginAssist");
const { stopPddLoginAssist } = require("../platforms/pdd/pddLoginAssist");
const { requestApplicationShutdown } = require("../shared/applicationShutdownSignal");

function stopPlatformLoginAssistRunners(dependencies = {}) {
  const stopJd = dependencies.stopJdLoginAssist || stopJdLoginAssist;
  const stopPdd = dependencies.stopPddLoginAssist || stopPddLoginAssist;
  stopJd();
  stopPdd();
}

async function shutdownCliResources(dependencies = {}) {
  requestApplicationShutdown();
  stopPlatformLoginAssistRunners(dependencies);
  const closeBrowser = dependencies.closeManagedChrome || closeManagedChrome;
  await closeBrowser().catch(() => {});
  const cleanBrowserCaches = dependencies.cleanRuntimeBrowserCaches || cleanRuntimeBrowserCachesWhenSafe;
  const cleanDownloadRuns = dependencies.cleanRuntimeDownloadRuns || cleanRuntimeDownloadRunsWhenSafe;
  cleanBrowserCaches("CLI退出后自动清理");
  cleanDownloadRuns("CLI退出后自动清理");
}

module.exports = {
  stopPlatformLoginAssistRunners,
  shutdownCliResources
};
