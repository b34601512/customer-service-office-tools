const scheduleQueryConfig = require("./scheduleQueryConfig");
const { log } = require("../../engine/logger");
const { readScheduleSheetMatrix } = require("./scheduleSheetFetcher");
const {
  buildDailyShiftMap,
  resolveMonthSheetName
} = require("./scheduleMatrixParser");
const {
  clearSnapshotDir,
  saveDailyScheduleSnapshot
} = require("./scheduleSnapshotStore");
const { isMarkedBackgroundColor } = require("./scheduleStyleParser");

function summarizeDutyColors(dateKey, backgroundMatrix, shiftMap) {
  // 常驻诊断：把“今天哪些人带值班背景色”写进日志，排障时不用再翻金山表格猜。
  const coloredCellCount = Array.isArray(backgroundMatrix)
    ? backgroundMatrix.reduce(
        (total, row) =>
          total +
          (Array.isArray(row) ? row.filter((cell) => isMarkedBackgroundColor(cell)).length : 0),
        0
      )
    : 0;
  const coloredMembers = Object.entries(shiftMap || {})
    .filter(([, shiftInfo]) => shiftInfo?.hasBackgroundColor === true)
    .map(([staffName, shiftInfo]) => `${staffName}(${shiftInfo.normalizedShift || "-"}|${shiftInfo.backgroundColor || "无色"})`);
  return `日期=${dateKey}，整表带色单元格=${coloredCellCount}，当天带色值班=${coloredMembers.length > 0 ? coloredMembers.join(" / ") : "无"}`;
}

function formatDateKey(targetDate) {
  // 这里统一生成日期缓存键，避免今天和明天的排班缓存串在一起。
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, "0");
  const day = String(targetDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(baseDate, offsetDays) {
  // 这里生成相邻日期，保证跨天读取排班时不直接修改原始日期对象。
  const result = new Date(baseDate.getTime());
  result.setDate(result.getDate() + offsetDays);
  return result;
}

function createDailyScheduleService(options = {}) {
  // 这里提供通用排班缓存读取能力，避免下班监控和无人在线各自维护一套排班读取代码。
  const dayCache = new Map();
  const monthCache = new Map();
  const logModuleName = String(options.logModuleName || "排班读取").trim() || "排班读取";
  let snapshotPreparedForSession = false;

  async function readMonthMatrix(targetDate, scheduleUrl = scheduleQueryConfig.defaultScheduleUrl) {
    // 这里按月份缓存原始矩阵，避免同一天内反复拉金山表格。
    const monthKey = resolveMonthSheetName(targetDate);
    if (monthCache.has(monthKey)) {
      return monthCache.get(monthKey);
    }

    const result = await readScheduleSheetMatrix(targetDate, scheduleUrl);
    if (!snapshotPreparedForSession) {
      clearSnapshotDir();
      snapshotPreparedForSession = true;
    }

    const snapshotPath = saveDailyScheduleSnapshot(targetDate, result.sheetName, result.matrix, undefined, {
      clearBeforeWrite: false
    });
    const value = {
      sheetName: result.sheetName,
      matrix: result.matrix,
      backgroundMatrix: result.backgroundMatrix,
      backgroundColorAvailable: result.backgroundColorAvailable === true,
      snapshotPath
    };
    monthCache.set(monthKey, value);
    log(
      "主线:完成",
      logModuleName,
      "缓存月排班",
      `工作表=${result.sheetName}，快照=${snapshotPath}`
    );
    return value;
  }

  async function readDailyShiftMap(targetDate) {
    // 这里把指定日期排班压成姓名到班次的映射，供上层规则直接消费。
    const dateKey = formatDateKey(targetDate);
    if (dayCache.has(dateKey)) {
      return dayCache.get(dateKey);
    }

    const monthData = await readMonthMatrix(targetDate);
    const value = {
      dateKey,
      sheetName: monthData.sheetName,
      snapshotPath: monthData.snapshotPath,
      backgroundColorAvailable: monthData.backgroundColorAvailable === true,
      shiftMap: buildDailyShiftMap(monthData.matrix, targetDate, monthData.backgroundMatrix)
    };
    dayCache.set(dateKey, value);
    log(
      "主线:执行",
      logModuleName,
      "排班颜色清单",
      summarizeDutyColors(value.dateKey, monthData.backgroundMatrix, value.shiftMap)
    );
    return value;
  }

  async function readShiftMapsForDate(baseDate = new Date()) {
    // 这里一次返回今天和明天排班，兼容需要展示明日班次的调用方。
    const today = await readDailyShiftMap(baseDate);
    const tomorrow = await readDailyShiftMap(addDays(baseDate, 1));
    return {
      today,
      tomorrow
    };
  }

  return {
    readDailyShiftMap,
    readShiftMapsForDate
  };
}

module.exports = {
  createDailyScheduleService,
  formatDateKey
};
