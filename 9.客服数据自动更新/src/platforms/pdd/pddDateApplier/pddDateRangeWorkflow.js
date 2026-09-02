// 该文件用于调度拼多多日期范围的打开、导航、点选、确认和报表就绪流程。
const { log } = require("../../../engine/logger");
const { isPddDateRangeTextMatched } = require("./pddDateText");
const { readPddDateInputValues } = require("./pddDateInputState");
const { readPddReportDataSignature, waitForPddReportReadyAfterDateApply } = require("./pddReportState");
const { openPddDatePanel, navigatePddCalendarToVisibleRange } = require("./pddCalendarNavigation");
const { clickPddDateCell, clickPddDatePanelConfirm } = require("./pddDateSelection");
const { waitForPddDatePanelClosed } = require("./pddDatePanelState");

async function applyPddDateRange(page, range) {
  // 这里把拼多多下载前置日期收口成“打开面板 -> 点日期 -> 确认 -> 校验生效”，避免直接下载旧日期。
  if (!range?.startDate || !range?.endDate) {
    throw new Error("拼多多日期区间不能为空。");
  }

  const currentValues = await readPddDateInputValues(page);
  if (currentValues.some((value) => isPddDateRangeTextMatched(value, range))) {
    log("主线:等待", "拼多多日期", "无需修改", `页面日期已是 ${range.startText} 到 ${range.endText}，继续确认下载入口可用`);
    const appliedText = await waitForPddReportReadyAfterDateApply(page, range, 30000, {
      previousReportSignature: ""
    });
    log("主线:完成", "拼多多日期", "页面结果", `页面日期文本=${appliedText || "未读到"}`);
    return range;
  }

  const previousReportSignature = await readPddReportDataSignature(page);
  log("主线:执行", "拼多多日期", "打开面板", `准备设置日期范围：${range.startText} 到 ${range.endText}`);
  await openPddDatePanel(page);
  const panelState = await navigatePddCalendarToVisibleRange(page, range.startDate, range.endDate);
  await clickPddDateCell(page, panelState, range.startDate);
  await clickPddDateCell(page, panelState, range.endDate);
  await clickPddDatePanelConfirm(page);
  await waitForPddDatePanelClosed(page);
  log("主线:等待", "拼多多日期", "报表刷新", "日期已确认，等待报表区数据刷新完成后再允许下载。");
  const appliedText = await waitForPddReportReadyAfterDateApply(page, range, 30000, { previousReportSignature });
  log("主线:完成", "拼多多日期", "页面结果", `页面日期文本=${appliedText || "未读到"}`);
  return range;
}

module.exports = { applyPddDateRange };
