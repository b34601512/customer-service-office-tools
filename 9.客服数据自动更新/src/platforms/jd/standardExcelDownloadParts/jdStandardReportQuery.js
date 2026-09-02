// 该文件用于解决京东报表查询刷新这一段公共流程问题。
const { log } = require("../../../engine/logger");
const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const { waitForJdDateFilterApplied } = require("../jdDateApplier");
const { waitForJdReportRefreshAfterSearch } = require("../jdDateRefreshWaiter");
const { getJdSearchButton } = require("../jdControls");
const { captureJdResultState, waitForJdQueryResultReady } = require("../jdQueryResultState");
const { waitForLocatorActionable } = require("../jdReportNavigation");
const { reportProgress } = require("../downloadTaskParts/jdDownloadProgress");

async function executeJdStandardReportQuery({
  page,
  surface,
  exportRange,
  applyDateRange,
  onProgress = null
}) {
  // 这里只负责把京东系统报表页按日期查询到稳定结果。
  if (!page || !surface) {
    throw new Error("京东报表查询失败：缺少可操作的报表页面。");
  }
  if (typeof applyDateRange !== "function") {
    throw new Error("京东报表查询失败：缺少日期设置函数。");
  }

  reportProgress(onProgress, "填写日期", `${exportRange.startText} 到 ${exportRange.endText}`);
  await applyDateRange(page, surface, exportRange);

  // 京东当前页面的客服组候选由平台动态控制，无法稳定表达“售前岗位”。
  // 下载和汇总阶段都保留全量客服数据；金山在线文档透视表由用户按“客服岗位”筛选。
  reportProgress(onProgress, "客服范围", "不筛选客服组，直接使用全部客服数据");

  reportProgress(onProgress, "等待查询按钮就绪", "确认当前页面已完成日期回填，准备执行查询");
  const searchButton = await waitForLocatorActionable(getJdSearchButton(surface), "查询", 15000);
  const reportSnapshotBeforeSearch = await captureJdResultState(surface, exportRange);

  reportProgress(onProgress, "执行查询", "准备按当前日期配置刷新结果");
  await clickLocatorWhenReady(searchButton, "京东查询按钮", { timeoutMs: 5000 });

  reportProgress(onProgress, "等待查询结果稳定", "按页面状态确认结果刷新，不按固定时间等待");
  await waitForJdDateFilterApplied(surface, exportRange);
  const refreshSnapshot = await waitForJdReportRefreshAfterSearch(
    surface,
    exportRange,
    reportSnapshotBeforeSearch,
    30000
  );
  const resultSnapshot = await waitForJdQueryResultReady(
    surface,
    exportRange,
    {
      ...reportSnapshotBeforeSearch,
      rowCount: 0,
      summaryText: "",
      emptyText: "",
      hasDataRows: false,
      exportDisabled: true
    },
    60000
  );

  log(
    "主线:完成",
    "京东下载",
    "查询结果稳定",
    `日期命中=${refreshSnapshot.rangeMatched ? "是" : "否"}，数据行数=${resultSnapshot.rowCount}，空态=${resultSnapshot.emptyText || "无"}`
  );
  return resultSnapshot;
}

module.exports = {
  executeJdStandardReportQuery
};
