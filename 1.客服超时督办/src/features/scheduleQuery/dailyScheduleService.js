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
      shiftMap: buildDailyShiftMap(monthData.matrix, targetDate)
    };
    dayCache.set(dateKey, value);
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
