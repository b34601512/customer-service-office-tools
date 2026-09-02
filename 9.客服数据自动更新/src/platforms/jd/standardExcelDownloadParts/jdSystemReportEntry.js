// 该文件用于解决京东系统后台模式进入店铺数据报表页的问题。
const { enterJdSystemReceptionDataReport } = require("../jdSystemReportNavigation");
const { reportProgress } = require("../downloadTaskParts/jdDownloadProgress");

async function openJdSystemReportContext({ browser, readyPage, resolvedConfig, onProgress = null }) {
  // 这里对外提供京东系统后台模式的报表页上下文，让后续查询导出流程不关心入口细节。
  reportProgress(onProgress, "进入店铺数据页", "准备进入京东系统「店铺数据 / 数据明细」报表页");
  const reportSurface = await enterJdSystemReceptionDataReport(browser, {
    readyPage,
    siteUrl: resolvedConfig.activeStore.siteUrl,
    timeoutMs: 30000
  });
  const page = reportSurface.page;
  await page.bringToFront();
  return {
    page,
    surface: reportSurface.surface,
    storeKey: resolvedConfig.activeStore.key
  };
}

module.exports = {
  openJdSystemReportContext
};
