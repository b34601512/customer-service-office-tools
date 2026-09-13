#!/usr/bin/env node
/**
 * 金山/WPS 在线表格（排班表）无GUI读取
 *
 * 配套笔记：同目录《金山在线表格排班表读取经验.md》
 *
 * 只读工具：不写入任何在线文档；不保存、不打印 Cookie/token；
 * 匿名可访问的排班链接直接读，需要登录的链接请用本机已登录的浏览器画像。
 *
 * 用法（Windows PowerShell）：
 *   $env:NODE_PATH = "D:\桌面\办公软件\1.客服超时督办\node_modules"
 *   node .\金山在线表格排班表读取.cjs --url https://www.kdocs.cn/l/分享ID --date 2026-09-13 --out 输出目录
 *
 * 参数：
 *   --url        必填，https://www.kdocs.cn/l/{shareId}
 *   --date       选填，YYYY-MM-DD，默认今天；决定读哪张月表、哪一列
 *   --sheet      选填，显式指定工作表名，默认 `${年}年${月}月`
 *   --out        选填，输出目录，默认当前目录
 *   --browser    选填，msedge（默认）或 chrome
 *   --headful    选填，true 显示浏览器窗口，默认无头
 *   --employee   选填，只打印该员工当天结果
 *   --debug      选填，true 时额外落盘每格原始取色（type/fore/back）便于排障
 *
 * 输出文件：
 *   schedule-values.json   原始矩阵（getRangeContents().result.Values）
 *   schedule-colors.json   与矩阵同形状的 #RRGGBB 背景色矩阵（空串=无填充）
 *   schedule-snapshot.tsv  矩阵 TSV 快照，便于人工复核
 *   schedule-report.json   验收与班次汇总（含取色是否可用、有色人员顺序）
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    out[key.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.url) {
  console.error('缺少 --url。示例：node 金山在线表格排班表读取.cjs --url https://www.kdocs.cn/l/分享ID --date 2026-09-13 --out 输出目录');
  process.exit(2);
}

const SCHEDULE_URL = args.url;
const OUT_DIR = path.resolve(args.out || '.');
const HEADFUL = String(args.headful || '').toLowerCase() === 'true';
const EMPLOYEE = String(args.employee || '').trim();
const DEBUG_COLORS = String(args.debug || '').toLowerCase() === 'true';

function parseDate(text) {
  const value = String(text || '').trim();
  if (!value) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`日期格式错误，请使用 YYYY-MM-DD：${value}`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`日期不存在：${value}`);
  }
  return date;
}

const TARGET_DATE = parseDate(args.date);
const SHEET_NAME = String(args.sheet || '').trim() || `${TARGET_DATE.getFullYear()}年${TARGET_DATE.getMonth() + 1}月`;

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (error) {
  console.error('找不到 playwright-core。请设置 NODE_PATH 指向已有依赖，例如：');
  console.error('  $env:NODE_PATH = "D:\\桌面\\办公软件\\1.客服超时督办\\node_modules"');
  process.exit(2);
}

function resolveBrowserLaunchOptions() {
  const requested = String(args.browser || '').trim();
  if (requested) {
    return { channel: requested };
  }

  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ].filter(Boolean);

  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  return executablePath
    ? { executablePath }
    : { channel: 'msedge' };
}

async function dismissLoginPopupIfPresent(page) {
  // 匿名访问金山表格会弹登录邀请层，先关掉，避免遮挡和干扰后续等待。
  try {
    const button = page.locator('#util-popup .wps-login-panel__header__right button');
    if ((await button.count()) === 0) return false;
    await button.first().click({ timeout: 5000 });
    return true;
  } catch (error) {
    return false;
  }
}

async function waitForWorkbookReady(page, sheetName, timeoutMs) {
  // 等金山表格运行时和目标工作表对象真正就绪；用毫秒轮询，避免后台页 rAF 停摆。
  await page.waitForFunction(
    (targetSheetName) => {
      const workbook = window.APP && window.APP.workbook;
      if (!workbook || typeof workbook.getWorksheets !== 'function') return false;
      const worksheets = workbook.getWorksheets();
      if (!worksheets || typeof worksheets.getItemByName !== 'function') return false;
      const sheet = worksheets.getItemByName(targetSheetName);
      if (!sheet || typeof sheet.loadSheetData !== 'function' || typeof sheet.getUsedRange !== 'function') {
        return false;
      }
      const usedRange = sheet.getUsedRange();
      return Boolean(usedRange && typeof usedRange.getRangeContents === 'function');
    },
    sheetName,
    { polling: 250, timeout: timeoutMs }
  );
}

async function readScheduleSheet(page, sheetName, debugColors) {
  return page.evaluate(async ({ targetSheetName, collectDebug }) => {
    const workbook = window.APP && window.APP.workbook;
    if (!workbook || typeof workbook.getWorksheets !== 'function') {
      throw new Error('页面里的工作簿对象还没有准备好。');
    }

    const worksheets = workbook.getWorksheets();
    const sheet = worksheets.getItemByName(targetSheetName);
    if (!sheet) {
      const names = typeof worksheets.getItems === 'function'
        ? worksheets.getItems().map((item) => item && item.getName && item.getName())
        : [];
      throw new Error(`没有找到工作表「${targetSheetName}」。可用工作表：${JSON.stringify(names)}`);
    }

    if (typeof sheet.activate === 'function') {
      await sheet.activate();
    }
    await sheet.loadSheetData();

    const usedRange = sheet.getUsedRange();
    if (!usedRange || typeof usedRange.getRangeContents !== 'function') {
      throw new Error(`工作表「${targetSheetName}」的已用区域还没有准备好。`);
    }

    const rangeContents = await usedRange.getRangeContents();
    const matrix = rangeContents && rangeContents.result && rangeContents.result.Values;
    if (!Array.isArray(matrix) || matrix.length === 0) {
      throw new Error(`工作表「${targetSheetName}」没有返回有效内容。`);
    }

    // getAppliedXf 用的是绝对行列号，矩阵从已用区域左上角开始，所以要补偏移。
    const usedRangeEntry = Array.isArray(usedRange._ranges) ? usedRange._ranges[0] : null;
    const rowOffset = Number((usedRangeEntry && (usedRangeEntry.rowFrom ?? usedRangeEntry.row)) || 0);
    const columnOffset = Number((usedRangeEntry && (usedRangeEntry.colFrom ?? usedRangeEntry.col)) || 0);

    const toHexColor = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `#${(value >>> 0 & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
      }
      const text = String(value || '').trim().toUpperCase();
      const match = text.match(/^#?([0-9A-F]{6})$/);
      return match ? `#${match[1]}` : '';
    };

    const readCellFill = (rowIndex, columnIndex) => {
      // 关键：必须用 getAppliedXf（有效样式），getXfByCell 读不到条件格式下的底色。
      const appliedXf = sheet.getAppliedXf(rowOffset + rowIndex, columnOffset + columnIndex);
      const result = { type: '', fore: '', back: '', visible: '', source: '' };

      try {
        const fill = appliedXf && typeof appliedXf.getFill === 'function' ? appliedXf.getFill() : null;
        if (fill) {
          result.type = typeof fill.getType === 'function' ? String(fill.getType() || '') : '';
          if (!/none/i.test(result.type)) {
            const back = typeof fill.getBack === 'function' ? fill.getBack() : null;
            const fore = typeof fill.getFore === 'function' ? fill.getFore() : null;
            result.back = toHexColor(back && typeof back.getRGB === 'function' ? back.getRGB() : '');
            result.fore = toHexColor(fore && typeof fore.getRGB === 'function' ? fore.getRGB() : '');
            result.source = 'api';
          }
        }
      } catch (error) {
        result.apiError = String(error && error.message);
      }

      if (!result.source) {
        // 回退：直接读运行时内部结构（14 号项目实测可用），兼容个别版本没有公开 getFill 的情况。
        try {
          const priv = appliedXf && appliedXf.private ? appliedXf.private : appliedXf;
          const fill = priv && priv.fill ? (priv.fill.private ? priv.fill.private : priv.fill) : null;
          if (fill) {
            result.type = String(fill.type || '');
            if (!/none/i.test(result.type)) {
              result.fore = toHexColor(fill.fore && fill.fore.rgbValue);
              result.back = toHexColor(fill.back && fill.back.rgbValue);
              result.source = 'internal';
            }
          }
        } catch (error) {
          result.internalError = String(error && error.message);
        }
      }

      // 实心填充取可见色：KDocs 实测可见色在 back（如 #E2F0D9），fore 常为 #000000；
      // 稳妥顺序是“非黑的 back → 非黑的 fore → 任意有效值”。
      if (!/none/i.test(result.type)) {
        if (result.back && result.back !== '#000000') result.visible = result.back;
        else if (result.fore && result.fore !== '#000000') result.visible = result.fore;
        else result.visible = result.back || result.fore || '';
      }
      return result;
    };

    const backgroundMatrix = [];
    const debugMatrix = [];
    let backgroundColorAvailable = true;
    let backgroundColorError = '';
    try {
      if (typeof sheet.getAppliedXf !== 'function') {
        throw new Error('工作表运行时不支持 getAppliedXf，有效背景色不可读取。');
      }
      for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
        const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
        const colorRow = [];
        const debugRow = [];
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
          const fill = readCellFill(rowIndex, columnIndex);
          colorRow.push(/none/i.test(fill.type) ? '' : (fill.visible || ''));
          if (collectDebug) debugRow.push(fill);
        }
        backgroundMatrix.push(colorRow);
        if (collectDebug) debugMatrix.push(debugRow);
      }
    } catch (error) {
      backgroundColorAvailable = false;
      backgroundColorError = String(error && error.message);
    }

    return {
      sheetName: typeof sheet.getName === 'function' ? sheet.getName() : targetSheetName,
      rowOffset,
      columnOffset,
      matrix,
      backgroundMatrix,
      backgroundColorAvailable,
      backgroundColorError,
      debugMatrix: collectDebug ? debugMatrix : null
    };
  }, { targetSheetName: sheetName, collectDebug: debugColors });
}

function normalizeShiftCode(rawShift) {
  const shiftCode = String(rawShift || '').trim();
  if (!shiftCode) return '休息';
  return { 早: '早班', 晚: '晚班', 年: '年假', 行: '行政' }[shiftCode] || shiftCode;
}

const SCHEDULE_STRUCTURE_LABELS = new Set([
  '日期', '星期', '月份', '职务', '售前', '售后', '早班', '晚班', '休息',
  '年假', '行政', '剩余', '实到', '应到', '备注', '上班人数'
]);

function isMarkedBackgroundColor(color) {
  const value = String(color || '').trim().toUpperCase();
  return Boolean(value && value !== '#FFFFFF');
}

function parseMatrix(matrix, backgroundMatrix, targetDate) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new Error('排班表数据为空，无法解析班次。');
  }

  const headerRow = matrix.find((row) => Array.isArray(row) && row.includes('日期'));
  if (!headerRow) {
    throw new Error('排班表里没有找到“日期”表头，无法定位日期列。');
  }

  // 该表布局：表头行里「日期」所在列，下方就是员工姓名列（左侧列是“售前/售后”分组）。
  const nameColumnIndex = headerRow.findIndex((cell) => String(cell || '').trim() === '日期');
  const dayNumber = targetDate.getDate();
  let dateColumnIndex = -1;
  for (let index = nameColumnIndex + 1; index < headerRow.length; index += 1) {
    if (Number(String(headerRow[index] || '').trim()) === dayNumber) {
      dateColumnIndex = index;
      break;
    }
  }
  if (dateColumnIndex < 0) {
    throw new Error(`排班表里没有找到「${dayNumber}」号对应的日期列。`);
  }

  const shiftMap = {};
  for (const [rowIndex, row] of matrix.entries()) {
    if (!Array.isArray(row) || row.length <= dateColumnIndex) continue;
    const employeeName = String(row[nameColumnIndex] || '').trim();
    if (!employeeName || SCHEDULE_STRUCTURE_LABELS.has(employeeName)) continue;
    const rawShift = String(row[dateColumnIndex] || '').trim();
    const backgroundColor = backgroundMatrix
      ? String((backgroundMatrix[rowIndex] || [])[dateColumnIndex] || '').trim().toUpperCase()
      : '';
    shiftMap[employeeName] = {
      employeeName,
      group: String(row[nameColumnIndex - 1] || '').trim(),
      rawShift,
      normalizedShift: normalizeShiftCode(rawShift),
      backgroundColor,
      hasBackgroundColor: isMarkedBackgroundColor(backgroundColor)
    };
  }

  return {
    headerRowIndex: matrix.indexOf(headerRow),
    nameColumnIndex,
    dateColumnIndex,
    shiftMap
  };
}

function matrixToTsv(matrix) {
  return matrix
    .map((row) => (Array.isArray(row) ? row : []).map((cell) => String(cell ?? '')).join('\t'))
    .join('\r\n');
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    ...resolveBrowserLaunchOptions(),
    headless: !HEADFUL,
    args: ['--disable-blink-features=AutomationControlled']
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1200 },
      locale: 'zh-CN'
    });

    await page.goto(SCHEDULE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    let userInfo = null;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await dismissLoginPopupIfPresent(page);
      try {
        await waitForWorkbookReady(page, SHEET_NAME, 60000);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;

    // 关掉可能延迟出现的登录弹窗，防止它盖住页面。
    await dismissLoginPopupIfPresent(page);

    const result = await readScheduleSheet(page, SHEET_NAME, DEBUG_COLORS);

    fs.writeFileSync(
      path.join(OUT_DIR, 'schedule-values.json'),
      JSON.stringify(result.matrix, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(OUT_DIR, 'schedule-colors.json'),
      JSON.stringify(result.backgroundMatrix, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(OUT_DIR, 'schedule-snapshot.tsv'),
      matrixToTsv(result.matrix),
      'utf8'
    );
    if (DEBUG_COLORS && result.debugMatrix) {
      // 只落盘有内容的格子，避免文件过大。
      const slim = [];
      for (let rowIndex = 0; rowIndex < result.debugMatrix.length; rowIndex += 1) {
        const row = result.debugMatrix[rowIndex];
        const entry = [];
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
          const fill = row[columnIndex];
          if (fill && (fill.type || fill.fore || fill.back)) {
            entry.push({ row: rowIndex, column: columnIndex, ...fill });
          }
        }
        if (entry.length) slim.push(...entry);
      }
      fs.writeFileSync(
        path.join(OUT_DIR, 'schedule-colors-debug.json'),
        JSON.stringify(slim, null, 2),
        'utf8'
      );
    }

    const parsed = parseMatrix(result.matrix, result.backgroundMatrix, TARGET_DATE);
    const dateKey = [
      TARGET_DATE.getFullYear(),
      String(TARGET_DATE.getMonth() + 1).padStart(2, '0'),
      String(TARGET_DATE.getDate()).padStart(2, '0')
    ].join('-');
    const colored = Object.values(parsed.shiftMap).filter((item) => item.hasBackgroundColor);

    const report = {
      网址: SCHEDULE_URL,
      页面标题: await page.title(),
      日期: dateKey,
      工作表: result.sheetName,
      矩阵行数: result.matrix.length,
      矩阵列数: Math.max(...result.matrix.map((row) => (Array.isArray(row) ? row.length : 0))),
      已用区域偏移: { rowFrom: result.rowOffset, colFrom: result.columnOffset },
      背景色可读取: result.backgroundColorAvailable,
      背景色错误: result.backgroundColorError || '',
      当日有色单元格数: colored.length,
      当日有色人员: colored.map((item) => ({
        姓名: item.employeeName,
        分组: item.group,
        班次: item.normalizedShift,
        原始班次: item.rawShift,
        底色: item.backgroundColor
      })),
      当日班次映射: parsed.shiftMap,
      非休息人员表: Object.values(parsed.shiftMap)
        .filter((item) => item.rawShift)
        .map((item) => `${item.employeeName}(${item.group}) ${item.normalizedShift} 底色=${item.backgroundColor || '无'}`)
    };
    if (EMPLOYEE) {
      report[`指定员工_${EMPLOYEE}`] = parsed.shiftMap[EMPLOYEE] || null;
    }

    fs.writeFileSync(
      path.join(OUT_DIR, 'schedule-report.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );

    console.log(JSON.stringify(report, null, 2));
    if (EMPLOYEE) {
      const info = parsed.shiftMap[EMPLOYEE];
      console.log(
        info
          ? `\n${EMPLOYEE} 在 ${dateKey} 的班次是「${info.normalizedShift}」（原始值：${info.rawShift || '空白'}，底色：${info.backgroundColor || '无'}）`
          : `\n排班表里没有找到员工「${EMPLOYEE}」。`
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(`读取失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
