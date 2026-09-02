const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const { getJdSearchButton } = require("../jdControls");
const { waitForLocatorActionable } = require("../jdReportNavigation");
const { waitForJdQueryResultReady } = require("../jdQueryResultState");
const { waitForJdDateFilterApplied } = require("../jdDateApplier");

async function refreshJdSystemReportAfterMetricChange(surface, exportRange) {
  // 这个函数只在指标变更后重新查询并等待报表结果就绪。
  await waitForJdDateFilterApplied(surface, exportRange);
  const searchButton = await waitForLocatorActionable(getJdSearchButton(surface), "查询", 15000);
  await clickLocatorWhenReady(searchButton, "京东查询按钮", { timeoutMs: 5000 });
  await waitForJdQueryResultReady(
    surface,
    exportRange,
    {
      rowCount: 0,
      summaryText: "",
      emptyText: "",
      hasDataRows: false,
      exportDisabled: true
    },
    60000
  );
}

module.exports = {
  refreshJdSystemReportAfterMetricChange
};
