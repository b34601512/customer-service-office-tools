// 该文件只负责抖音导出日期选择与查询结果验收。
const { runAfterDismissingBlockingPopups } = require("../../../shared/blockingPopupEngine");
const { waitForDouyinExportButtonReady } = require("./douyinExportButton");

function isSameDate(leftDate, rightDate) {
  // 该函数只比较两个日期是否为同一个自然日。
  return leftDate && rightDate && leftDate.getFullYear() === rightDate.getFullYear() && leftDate.getMonth() === rightDate.getMonth() && leftDate.getDate() === rightDate.getDate();
}

async function runDouyinDateControlAction(page, action) {
  // 该函数只保证一个日期控件动作不会被异步晚到的已知安全弹层阻断。
  return runAfterDismissingBlockingPopups(page, action, { platformName: "抖音" });
}

function buildDouyinDateCellSelector(dateText) {
  // 该函数只生成“目标日期 + 当前月份 + 可点击”的唯一日期格规则。
  return `.ecom-picker-dropdown td.ecom-picker-cell-in-view[title="${dateText}"]:not(.ecom-picker-cell-disabled) .ecom-picker-cell-inner`;
}

async function applyDouyinDateRange(page, exportRange) {
  // 按真实页面控件选择日期，月度汇总需要支持自定义起止日期。
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (isSameDate(exportRange.startDate, yesterday) && isSameDate(exportRange.endDate, yesterday)) {
    await runDouyinDateControlAction(page, () => page.getByText("昨天", { exact: true }).click({ timeout: 10000 }));
    await runDouyinDateControlAction(page, () => page.getByText("查询", { exact: true }).click({ timeout: 10000 }));
    await waitForDouyinQueryResult(page, exportRange);
    return;
  }
  if (isSameDate(exportRange.startDate, today) && isSameDate(exportRange.endDate, today)) {
    await runDouyinDateControlAction(page, () => page.getByText("今天", { exact: true }).click({ timeout: 10000 }));
    await runDouyinDateControlAction(page, () => page.getByText("查询", { exact: true }).click({ timeout: 10000 }));
    await waitForDouyinQueryResult(page, exportRange);
    return;
  }
  const startInput = page.locator('input[placeholder="开始日期"]');
  const endInput = page.locator('input[placeholder="结束日期"]');
  if ((await startInput.count()) !== 1 || (await endInput.count()) !== 1) {
    throw new Error("未找到抖音自定义日期输入框，请确认页面仍在客服数据页。");
  }
  await runDouyinDateControlAction(page, () => startInput.click({ timeout: 10000 }));
  await clickDouyinDateCell(page, exportRange.startText);
  await clickDouyinDateCell(page, exportRange.endText);
  await runDouyinDateControlAction(page, () => page.getByText("查询", { exact: true }).click({ timeout: 10000 }));
  await waitForDouyinQueryResult(page, exportRange);
}

async function clickDouyinDateCell(page, dateText) {
  // 抖音双月面板会复制相邻月日期，只允许点击当前月份内的唯一真实日期格。
  const dateCellSelector = buildDouyinDateCellSelector(dateText);
  for (let attemptIndex = 0; attemptIndex < 12; attemptIndex += 1) {
    const targetDateCells = page.locator(dateCellSelector);
    const matchedCount = await targetDateCells.count();
    if (matchedCount === 1) {
      await runDouyinDateControlAction(page, () => targetDateCells.click({ timeout: 10000 }));
      return;
    }
    if (matchedCount > 1) {
      throw new Error(`抖音日期面板里出现多个可点击日期：${dateText}`);
    }
    await page.locator(".ecom-picker-dropdown .ecom-picker-header-prev-btn").first().click({ timeout: 10000 });
    await page.waitForTimeout(300);
  }
  throw new Error(`抖音日期面板未找到可点击日期：${dateText}`);
}

async function waitForDouyinQueryResult(page, exportRange) {
  // 查询后必须确认日期已生效且表格回到可导出状态，避免导出上一轮数据。
  const startInput = page.locator('input[placeholder="开始日期"]').first();
  const endInput = page.locator('input[placeholder="结束日期"]').first();
  await page.waitForFunction(
    ({ startText, endText }) => {
      const startElement = document.querySelector('input[placeholder="开始日期"]');
      const endElement = document.querySelector('input[placeholder="结束日期"]');
      return startElement?.value === startText && endElement?.value === endText;
    },
    { startText: exportRange.startText, endText: exportRange.endText },
    { timeout: 10000 }
  );
  await page.waitForFunction(
    () => /共\s*\d+\s*条数据/.test(document.body?.innerText || "") || /暂无数据|没有数据/.test(document.body?.innerText || ""),
    null,
    { timeout: 30000 }
  );
  const bodyText = await page.locator("body").innerText({ timeout: 5000 });
  if (/暂无数据|没有数据/.test(bodyText)) {
    throw new Error(`抖音 ${exportRange.startText} 到 ${exportRange.endText} 查询后没有数据，无法导出。`);
  }
  await waitForDouyinExportButtonReady(page);
}

module.exports = {
  applyDouyinDateRange,
  buildDouyinDateCellSelector
};
