const { log } = require("../../../engine/logger");
const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const { waitForJdDateFilterApplied } = require("../jdDateApplier");
const { waitForVisibleJdSystemDatePanel } = require("./jdSystemDatePanel");
const { navigateJdSystemCalendar } = require("./jdSystemDateNavigation");
const {
  getVisibleJdSystemDateEditor,
  clickJdSystemDateRangeCells,
  dismissJdSystemDatePanelIfNeeded
} = require("./jdSystemDateSelection");

function assertJdSystemDateRange(range) {
  // 这个函数只校验京东系统日期应用所需的起止日期。
  if (!range?.startDate || !range?.endDate) {
    throw new Error("京东系统日期区间不能为空。");
  }
}

async function applyJdSystemDateRange(_page, surface, range) {
  // 这个函数只按固定顺序调度京东系统日期应用流程。
  assertJdSystemDateRange(range);
  log("主线:执行", "京东系统日期", "打开面板", `准备设置日期范围：${range.startText} 到 ${range.endText}`);
  const editor = await getVisibleJdSystemDateEditor(surface);
  await clickLocatorWhenReady(editor, "京东系统日期范围控件", {
    timeoutMs: 5000,
    pollIntervalMs: 100,
    minimumClickIntervalMs: 150
  });
  const panel = await waitForVisibleJdSystemDatePanel(surface);
  const months = await navigateJdSystemCalendar(panel, range.startDate, range.endDate);
  await clickJdSystemDateRangeCells(panel, months, range.startDate, range.endDate);
  const appliedText = await waitForJdDateFilterApplied(surface, range);
  await dismissJdSystemDatePanelIfNeeded(surface);
  log("主线:完成", "京东系统日期", "页面结果", `页面日期文本=${appliedText || "未读到"}`);
  return range;
}

module.exports = {
  applyJdSystemDateRange
};
