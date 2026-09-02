const { chromium } = require("playwright-core");
const { waitForReadableBody } = require("../../engine/pageReadiness");
const { log } = require("../../engine/logger");
const { waitForPageFunction } = require("../../engine/pageWait");
const { resolveChromePath } = require("../../engine/browserExecutable");
const scheduleQueryConfig = require("./scheduleQueryConfig");
const { resolveMonthSheetName } = require("./scheduleMatrixParser");

async function dismissLoginPopupIfPresent(page) {
  // 这里主动关闭匿名浏览时的登录邀请弹窗，避免它遮挡页面或干扰后续稳定性。
  const closeButton = page.locator("#util-popup .wps-login-panel__header__right button");
  if ((await closeButton.count()) === 0) {
    return false;
  }

  await closeButton.first().click({ timeout: 5000 });
  return true;
}

async function waitForScheduleWorkbookReady(page, monthSheetName) {
  // 这里等待金山表格运行时和目标工作表对象真正就绪，不用固定毫秒瞎等。
  await waitForReadableBody(page, scheduleQueryConfig.pageReadyTimeout);
  await waitForPageFunction(
    page,
    (targetSheetName) => {
      const workbook = window.APP && window.APP.workbook;
      if (!workbook || typeof workbook.getWorksheets !== "function") {
        return false;
      }

      const worksheets = workbook.getWorksheets();
      if (!worksheets || typeof worksheets.getItemByName !== "function") {
        return false;
      }

      const sheet = worksheets.getItemByName(targetSheetName);
      if (!sheet || typeof sheet.loadSheetData !== "function" || typeof sheet.getUsedRange !== "function") {
        return false;
      }

      const usedRange = sheet.getUsedRange();
      return Boolean(usedRange && typeof usedRange.getRangeContents === "function");
    },
    monthSheetName,
    { timeout: scheduleQueryConfig.pageReadyTimeout }
  );
}

async function readScheduleSheetMatrix(targetDate, scheduleUrl = scheduleQueryConfig.defaultScheduleUrl) {
  // 这里统一负责打开金山排班表并直接读取目标月份工作表矩阵。
  const monthSheetName = resolveMonthSheetName(targetDate);
  const executablePath = resolveChromePath("排班读取");

  log("主线:启动", "排班读取", "准备浏览器", `目标工作表：${monthSheetName}`);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  try {
    const page = await browser.newPage({
      viewport: scheduleQueryConfig.browserViewport,
      locale: "zh-CN"
    });

    log("主线:执行", "排班读取", "打开排班表", `目标网址：${scheduleUrl}`);
    await page.goto(scheduleUrl, {
      waitUntil: "domcontentloaded",
      timeout: scheduleQueryConfig.pageReadyTimeout
    });
    await dismissLoginPopupIfPresent(page);
    await waitForScheduleWorkbookReady(page, monthSheetName);

    log("主线:执行", "排班读取", "读取工作表", `开始直接读取「${monthSheetName}」原始矩阵`);
    const result = await page.evaluate(async ({ targetSheetName }) => {
      const workbook = window.APP && window.APP.workbook;
      if (!workbook || typeof workbook.getWorksheets !== "function") {
        throw new Error("页面里的工作簿对象还没有准备好。");
      }

      const worksheets = workbook.getWorksheets();
      if (!worksheets || typeof worksheets.getItemByName !== "function") {
        throw new Error("页面里的工作表集合不可用。");
      }

      const sheet = worksheets.getItemByName(targetSheetName);
      if (!sheet) {
        throw new Error(`没有找到工作表「${targetSheetName}」。`);
      }

      await sheet.loadSheetData();
      const usedRange = sheet.getUsedRange();
      if (!usedRange || typeof usedRange.getRangeContents !== "function") {
        throw new Error(`工作表「${targetSheetName}」的已用区域还没有准备好。`);
      }

      const rangeContents = await usedRange.getRangeContents();
      const matrix = rangeContents && rangeContents.result && rangeContents.result.Values;
      if (!Array.isArray(matrix) || matrix.length === 0) {
        throw new Error(`工作表「${targetSheetName}」没有返回有效内容。`);
      }

      return {
        sheetName: typeof sheet.getName === "function" ? sheet.getName() : targetSheetName,
        matrix
      };
    }, { targetSheetName: monthSheetName });

    log("主线:完成", "排班读取", "读取成功", `已读取「${result.sheetName}」，共 ${result.matrix.length} 行`);
    return result;
  } finally {
    await browser.close();
  }
}

module.exports = {
  readScheduleSheetMatrix
};
