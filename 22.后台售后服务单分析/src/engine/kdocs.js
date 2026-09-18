// 本文件只负责「用无头浏览器匿名读金山文档的单元格数据」，不含任何业务判断。
// 能力来源：1号 `src/features/scheduleQuery/scheduleSheetFetcher.js`（14号也照它抄过），2026-09-18 在 22号 复刻并实测。
//
// 关键实测（别随手改）：
// 1) 不需要 AirScript token、不需要登录：匿名打开分享链接即可；页面里 `window.APP.workbook` 是网页版 WPS 表格 API。
// 2) 就绪判断**不要死等秒数**：轮询探测 `workbook.getWorksheets().getItemByName(表名)` → `sheet.loadSheetData`
//    → `sheet.getUsedRange().getRangeContents` 这些函数是否都在（1号 的做法）。
// 3) 工作表集合（2026-09-18 售后台账表实测）：**没有** getCount/getItemByIndex，但有 `getNameList()`；
//    单个表用 `getItemByName(名字)`。读**非当前**工作表前先 `sheet.activate()`（1号 做法）。
// 4) 取数据：`sheet.loadSheetData()` → `sheet.getUsedRange().getRangeContents()` → `result.Values`（二维数组）。
// 5) 底色（条件格式）：`getXfByCell` 只给基础样式，必须 `sheet.getAppliedXf(行, 列).getFill().getBack().getRGB()`，
//    行列要用 `usedRange._ranges[0].rowFrom/colFrom` 做偏移（1号 做法）。
// 6) 只读：全程不输入、不点保存、不触发同步。
const fs = require("fs");
const { chromium } = require("playwright-core");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];

function resolveBrowserPath() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error("未找到 Chrome/Edge，无法打开金山文档。");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 打开文档 → 关登录浮层 → 等 WPS 表格 API 就绪 → 把页面交给 handler。
async function withWorkbook(documentUrl, options, handler) {
  const { headless = true, readyTimeoutMs = 60000, keepOpen = false } = options || {};
  const browser = await chromium.launch({
    executablePath: resolveBrowserPath(),
    headless,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, locale: "zh-CN" });
    await page.goto(documentUrl, { waitUntil: "domcontentloaded", timeout: readyTimeoutMs });
    // 匿名浏览时会出现登录邀请浮层，主动关掉，避免遮挡或干扰初始化。
    const closeButton = page.locator("#util-popup .wps-login-panel__header__right button");
    if (await closeButton.count()) await closeButton.first().click({ timeout: 5000 }).catch(() => {});

    const deadline = Date.now() + readyTimeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await page.evaluate(() => {
        const workbook = window.APP && window.APP.workbook;
        if (!workbook || typeof workbook.getWorksheets !== "function") return false;
        const worksheets = workbook.getWorksheets();
        if (!worksheets || typeof worksheets.getItemByName !== "function") return false;
        const sheet = worksheets.getItemByName(worksheets.getNameList ? worksheets.getNameList()[0] : "");
        return Boolean(sheet && typeof sheet.loadSheetData === "function" && typeof sheet.getUsedRange === "function");
      }).catch(() => false);
      if (ready) break;
      await sleep(1000);
    }
    if (!ready) throw new Error("金山文档 60 秒内没有出现可用的表格运行时（window.APP.workbook）。");

    const result = await handler(page);
    if (!keepOpen) await browser.close();
    return result;
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

// 列出文档里所有工作表名
async function listSheets(documentUrl, options) {
  return withWorkbook(documentUrl, options, (page) => page.evaluate(() => {
    const worksheets = window.APP.workbook.getWorksheets();
    return typeof worksheets.getNameList === "function" ? worksheets.getNameList() : [];
  }));
}

// 读一个工作表的整片内容：{ sheetName, sheetNames, matrix, rowCount, columnCount, backgroundMatrix }
// withColors=true 时额外读条件格式底色（较慢：逐格调用）。
async function readSheet(documentUrl, sheetName, options = {}) {
  const { withColors = false } = options;
  return withWorkbook(documentUrl, options, (page) => page.evaluate(async ({ target, colors }) => {
    const workbook = window.APP.workbook;
    const worksheets = workbook.getWorksheets();
    const sheetNames = typeof worksheets.getNameList === "function" ? worksheets.getNameList() : [];
    const sheet = worksheets.getItemByName(target);
    if (!sheet) throw new Error(`金山文档里没有工作表「${target}」。现有：${sheetNames.join(" / ")}`);
    if (typeof sheet.activate === "function") await sheet.activate();
    await sheet.loadSheetData();
    // 实测：activate() 之后 sheet 实例会换掉、usedRange 也可能要等一会才挂上 getRangeContents，
    // 所以要「重新取 sheet + 轮询等到就绪」，不能取一次就用。
    const deadline = Date.now() + 30000;
    let live = null;
    let usedRange = null;
    while (Date.now() < deadline) {
      live = worksheets.getItemByName(target);
      const candidate = live && typeof live.getUsedRange === "function" ? live.getUsedRange() : null;
      if (candidate && typeof candidate.getRangeContents === "function") { usedRange = candidate; break; }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!usedRange) {
      throw new Error(`工作表「${target}」的已用区域还没有准备好（等了 30 秒）。`);
    }
    const contents = await usedRange.getRangeContents();
    const matrix = contents && contents.result && contents.result.Values;
    if (!Array.isArray(matrix)) throw new Error(`工作表「${target}」没有返回有效内容。`);

    let backgroundMatrix = null;
    if (colors) {
      try {
        const entry = Array.isArray(usedRange._ranges) ? usedRange._ranges[0] : null;
        const rowOffset = Number(entry?.rowFrom || 0);
        const columnOffset = Number(entry?.colFrom || 0);
        const toHex = (value) => {
          if (typeof value === "number" && Number.isFinite(value)) return `#${((value >>> 0) & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
          const text = String(value || "").trim().toUpperCase();
          return /^#?[0-9A-F]{6}$/.test(text) ? `#${text.replace(/^#/, "")}` : "";
        };
        backgroundMatrix = matrix.map((row, rowIndex) => (Array.isArray(row) ? row : []).map((_cell, columnIndex) => {
          const appliedXf = live.getAppliedXf(rowOffset + rowIndex, columnOffset + columnIndex);
          const fill = appliedXf && typeof appliedXf.getFill === "function" ? appliedXf.getFill() : null;
          if (!fill || typeof fill.getBack !== "function") return "";
          const fillType = typeof fill.getType === "function" ? String(fill.getType() || "").toLowerCase() : "";
          if (fillType.includes("none")) return "";
          const back = fill.getBack();
          return toHex(back && typeof back.getRGB === "function" ? back.getRGB() : "");
        }));
      } catch (error) {
        backgroundMatrix = null; // 底色读不到不算失败，值照给
      }
    }

    return {
      sheetName: typeof live.getName === "function" ? live.getName() : target,
      sheetNames,
      matrix,
      backgroundMatrix,
      rowCount: matrix.length,
      columnCount: Math.max(...matrix.map((row) => (Array.isArray(row) ? row.length : 0)), 0)
    };
  }, { target: sheetName, colors: withColors }));
}

// 一次会话里读多个工作表（比逐表重开浏览器快很多）：返回 { 表名: { matrix, rowCount, columnCount, backgroundMatrix } }
async function readSheets(documentUrl, sheetNames, options = {}) {
  const { withColors = false } = options;
  return withWorkbook(documentUrl, options, async (page) => {
    const result = {};
    for (const name of sheetNames) {
      result[name] = await page.evaluate(async ({ target, colors }) => {
        const worksheets = window.APP.workbook.getWorksheets();
        const sheet = worksheets.getItemByName(target);
        if (!sheet) return { error: `没有工作表「${target}」` };
        if (typeof sheet.activate === "function") await sheet.activate();
        await sheet.loadSheetData();
        const deadline = Date.now() + 30000;
        let live = null;
        let usedRange = null;
        while (Date.now() < deadline) {
          live = worksheets.getItemByName(target);
          const candidate = live && typeof live.getUsedRange === "function" ? live.getUsedRange() : null;
          if (candidate && typeof candidate.getRangeContents === "function") { usedRange = candidate; break; }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        if (!usedRange) return { error: `工作表「${target}」已是用区域未就绪` };
        const contents = await usedRange.getRangeContents();
        const matrix = contents && contents.result && contents.result.Values;
        if (!Array.isArray(matrix)) return { error: `工作表「${target}」无有效内容` };

        let backgroundMatrix = null;
        if (colors) {
          try {
            const entry = Array.isArray(usedRange._ranges) ? usedRange._ranges[0] : null;
            const rowOffset = Number(entry?.rowFrom || 0);
            const columnOffset = Number(entry?.colFrom || 0);
            const toHex = (value) => {
              if (typeof value === "number" && Number.isFinite(value)) return `#${((value >>> 0) & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
              const text = String(value || "").trim().toUpperCase();
              return /^#?[0-9A-F]{6}$/.test(text) ? `#${text.replace(/^#/, "")}` : "";
            };
            backgroundMatrix = matrix.map((row, rowIndex) => (Array.isArray(row) ? row : []).map((_cell, columnIndex) => {
              const appliedXf = live.getAppliedXf(rowOffset + rowIndex, columnOffset + columnIndex);
              const fill = appliedXf && typeof appliedXf.getFill === "function" ? appliedXf.getFill() : null;
              if (!fill || typeof fill.getBack !== "function") return "";
              const fillType = typeof fill.getType === "function" ? String(fill.getType() || "").toLowerCase() : "";
              if (fillType.includes("none")) return "";
              const back = fill.getBack();
              return toHex(back && typeof back.getRGB === "function" ? back.getRGB() : "");
            }));
          } catch (error) {
            backgroundMatrix = null;
          }
        }
        return { matrix, backgroundMatrix, rowCount: matrix.length, columnCount: Math.max(...matrix.map((row) => (Array.isArray(row) ? row.length : 0)), 0) };
      }, { target: name, colors: withColors });
    }
    return result;
  });
}

module.exports = { listSheets, readSheet, readSheets, resolveBrowserPath };
