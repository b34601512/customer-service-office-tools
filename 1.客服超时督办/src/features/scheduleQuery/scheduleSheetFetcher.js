const { chromium } = require("playwright-core");
const { waitForReadableBody } = require("../../engine/pageReadiness");
const { log } = require("../../engine/logger");
const { waitForPageFunction } = require("../../engine/pageWait");
const { resolveEdgePath } = require("../../engine/browserExecutable");
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
  if (!scheduleUrl) throw new Error("尚未配置排班表地址，请在控制台「配置」填写并重新启动后台监控。");
  // 这里统一负责打开金山排班表并直接读取目标月份工作表矩阵。
  const monthSheetName = resolveMonthSheetName(targetDate);
  const executablePath = resolveEdgePath("排班读取");

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

      if (typeof sheet.activate === "function") {
        await sheet.activate();
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

      // KDocs 的 getXfByCell 只返回基础样式；值班标记可能来自条件格式，必须读取有效样式。
      // 颜色读取失败不影响班次值读取，由上层据此保留原有提醒而不自动转接。
      let backgroundMatrix = null;
      let backgroundColorAvailable = false;
      let backgroundColorError = "";
      try {
        if (typeof sheet.getAppliedXf !== "function") {
          throw new Error("工作表运行时不支持 getAppliedXf，有效背景色不可读取。");
        }

        const usedRangeEntry = Array.isArray(usedRange._ranges) ? usedRange._ranges[0] : null;
        const rowOffset = Number(usedRangeEntry?.rowFrom || 0);
        const columnOffset = Number(usedRangeEntry?.colFrom || 0);
        const toHexColor = (value) => {
          if (typeof value === "number" && Number.isFinite(value)) {
            return `#${(value >>> 0 & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
          }
          const text = String(value || "").trim().toUpperCase();
          return /^#?[0-9A-F]{6}$/.test(text) ? `#${text.replace(/^#/, "")}` : "";
        };
        backgroundMatrix = matrix.map((row, rowIndex) =>
          (Array.isArray(row) ? row : []).map((_cell, columnIndex) => {
            const appliedXf = sheet.getAppliedXf(rowOffset + rowIndex, columnOffset + columnIndex);
            const fill = appliedXf && typeof appliedXf.getFill === "function"
              ? appliedXf.getFill()
              : null;
            if (!fill || typeof fill.getBack !== "function") {
              return "";
            }
            const fillType = typeof fill.getType === "function"
              ? String(fill.getType() || "").toLowerCase()
              : "";
            if (fillType.includes("none")) {
              return "";
            }
            const back = fill.getBack();
            const rgb = back && typeof back.getRGB === "function" ? back.getRGB() : "";
            return toHexColor(rgb);
          })
        );
        backgroundColorAvailable = true;
      } catch (error) {
        backgroundMatrix = null;
        backgroundColorError = error instanceof Error ? error.message : String(error);
      }

      return {
        sheetName: typeof sheet.getName === "function" ? sheet.getName() : targetSheetName,
        matrix,
        backgroundMatrix,
        backgroundColorAvailable,
        backgroundColorError
      };
    }, { targetSheetName: monthSheetName });

    log(
      "主线:完成",
      "排班读取",
      "读取成功",
      `已读取「${result.sheetName}」，共 ${result.matrix.length} 行，有效背景色=${result.backgroundColorAvailable ? "可用" : "不可用"}`
    );
    if (!result.backgroundColorAvailable && result.backgroundColorError) {
      log(
        "主线:等待",
        "排班读取",
        "背景色不可用",
        `本轮自动转接将保留原有提醒：${result.backgroundColorError}`
      );
    }
    return result;
  } finally {
    await browser.close();
  }
}

module.exports = {
  readScheduleSheetMatrix
};
