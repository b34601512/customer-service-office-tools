const { log, logError } = require("./engine/logger");
const scheduleQueryConfig = require("./features/scheduleQuery/scheduleQueryConfig");
const { readScheduleSheetMatrix } = require("./features/scheduleQuery/scheduleSheetFetcher");
const {
  extractShiftFromMatrix,
  resolveMonthSheetName
} = require("./features/scheduleQuery/scheduleMatrixParser");
const { saveDailyScheduleSnapshot } = require("./features/scheduleQuery/scheduleSnapshotStore");

function formatLocalDate(targetDate) {
  // 这里统一输出本地日期字符串，避免终端结果和文件日期口径不一致。
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, "0");
  const day = String(targetDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseTargetDate(dateText) {
  // 这里显式校验命令行日期格式，避免隐式解析把日期读错还不报错。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error("日期格式错误，请使用 YYYY-MM-DD。");
  }

  const [yearText, monthText, dayText] = dateText.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const targetDate = new Date(year, monthIndex, day);

  if (
    Number.isNaN(targetDate.getTime()) ||
    targetDate.getFullYear() !== year ||
    targetDate.getMonth() !== monthIndex ||
    targetDate.getDate() !== day
  ) {
    throw new Error(`日期无效，请检查「${dateText}」是否存在。`);
  }

  return targetDate;
}

function resolveCliOptions(argv) {
  // 这里统一解析命令行参数，默认查询今天的班次；员工姓名必须显式传入（不入库默认值）。
  const employeeName = String(argv[2] || "").trim();
  const targetDate = parseTargetDate(argv[3] || formatLocalDate(new Date()));
  const scheduleUrl = String(argv[4] || scheduleQueryConfig.defaultScheduleUrl).trim();

  if (!employeeName) {
    throw new Error("员工姓名不能为空。");
  }

  if (!scheduleUrl) {
    throw new Error("排班表地址不能为空。");
  }

  return {
    employeeName,
    targetDate,
    scheduleUrl
  };
}

async function main() {
  // 这里编排“抓取排班表 -> 覆盖快照 -> 解析班次 -> 输出结果”的完整链路。
  const options = resolveCliOptions(process.argv);
  log(
    "主线:启动",
    "排班查询",
    "解析参数",
    `员工=${options.employeeName}，日期=${formatLocalDate(options.targetDate)}，目标工作表=${resolveMonthSheetName(options.targetDate)}`
  );

  const { sheetName, matrix } = await readScheduleSheetMatrix(options.targetDate, options.scheduleUrl);
  const snapshotPath = saveDailyScheduleSnapshot(options.targetDate, sheetName, matrix);
  log("主线:完成", "排班查询", "落盘快照", `已覆盖本地快照：${snapshotPath}`);

  const result = extractShiftFromMatrix(matrix, options.employeeName, options.targetDate);
  const outputLine =
    `${result.employeeName} 在 ${formatLocalDate(options.targetDate)} 的班次是「${result.normalizedShift}」` +
    `（原始值：${result.rawShift || "空白"}，快照：${snapshotPath}）`;

  log("主线:完成", "排班查询", "输出结果", outputLine);
  console.log(outputLine);
}

process.on("unhandledRejection", (error) => {
  throw error;
});

main().catch((error) => {
  logError("主线:失败", "排班查询", "异常退出", error);
  process.exitCode = 1;
});
