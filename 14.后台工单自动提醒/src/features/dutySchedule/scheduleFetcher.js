// 本文件负责用无头浏览器读金山排班表：矩阵 + 当日各员工格底色。
// 关键实测：getXfByCell 读不到条件格式色，必须 getAppliedXf；打开方式与 1 号相同（匿名访问）。
const { chromium } = require("playwright-core");
const fs = require("fs");
const { log } = require("../../engine/logger");
const { monthSheetName } = require("./dutyParser");

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchScheduleMonth(scheduleUrl, date) {
  const sheetName = monthSheetName(date);
  const executablePath = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) {
    throw new Error("未找到 Chrome，无法读取金山排班表。");
  }
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, locale: "zh-CN" });
    await page.goto(scheduleUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(3000);
    await page.evaluate(() => {
      const button = document.querySelector("#util-popup .wps-login-panel__header__right button");
      if (button) button.click();
    });
    for (let waited = 0; waited < 60; waited += 1) {
      const ready = await page.evaluate((target) => {
        const workbook = window.APP && window.APP.workbook;
        if (!workbook || typeof workbook.getWorksheets !== "function") return false;
        const sheet = workbook.getWorksheets().getItemByName(target);
        return Boolean(sheet && typeof sheet.getUsedRange === "function");
      }, sheetName).catch(() => false);
      if (ready) break;
      await sleep(1000);
    }

    const result = await page.evaluate(async ({ targetSheet, dayNumber }) => {
      const workbook = window.APP.workbook;
      const sheet = workbook.getWorksheets().getItemByName(targetSheet);
      if (!sheet) throw new Error(`金山文档里没有工作表「${targetSheet}」。`);
      await sheet.loadSheetData();
      const used = sheet.getUsedRange();
      const rc = await used.getRangeContents();
      const matrix = rc && rc.result && rc.result.Values;
      if (!Array.isArray(matrix) || matrix.length === 0) {
        throw new Error(`工作表「${targetSheet}」没有返回有效内容。`);
      }
      const STRUCTURE_NAMES = new Set(["星期", "姓名", "早班", "晚班", "休息", "上班人数", "备注", "日期"]);
      // 定位当日列
      const headerIdx = matrix.findIndex((row) => Array.isArray(row) && row.includes("日期"));
      let colorGrid = {};
      if (headerIdx >= 0) {
        const dayCol = matrix[headerIdx].findIndex(
          (cell, index) => index >= 2 && String(cell || "").trim() === String(dayNumber)
        );
        if (dayCol >= 0) {
          let group = "";
          for (let r = 0; r < matrix.length; r += 1) {
            const row = matrix[r];
            if (!Array.isArray(row)) continue;
            const groupCell = String(row[0] || "").trim();
            if (groupCell === "售前" || groupCell === "售后") group = groupCell;
            const name = String(row[1] || "").trim();
            if (!name || STRUCTURE_NAMES.has(name) || !group) continue;
            try {
              const applied = sheet.getAppliedXf(r, dayCol);
              const priv = applied && applied.private ? applied.private : applied;
              let fill = priv && priv.fill ? (priv.fill.private ? priv.fill.private : priv.fill) : null;
              let rgb = null;
              if (fill && fill.type !== "eftPatternNone") {
                const fore = fill.fore && fill.fore.rgbValue ? String(fill.fore.rgbValue).toUpperCase() : "";
                const back = fill.back && fill.back.rgbValue ? String(fill.back.rgbValue).toUpperCase() : "";
                rgb = (fore && fore !== "#000000" ? fore : back) || null;
              }
              colorGrid[`${r},${dayCol}`] = rgb;
            } catch (error) {
              colorGrid[`${r},${dayCol}`] = null;
            }
          }
        }
      }
      return { matrix, colorGrid };
    }, { targetSheet: sheetName, dayNumber: date.getDate() });

    log("排班", sheetName, "读取成功", `${result.matrix.length} 行，取色格 ${Object.keys(result.colorGrid).length} 个`);
    return { sheetName, ...result };
  } finally {
    await browser.close();
  }
}

module.exports = { fetchScheduleMonth };
