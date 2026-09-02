function resolveMonthSheetName(targetDate) {
  // 这里统一把日期转换成工作表名称，避免上层各处重复拼接月份字符串。
  return `${targetDate.getFullYear()}年${targetDate.getMonth() + 1}月`;
}

function findDateHeaderRow(matrix) {
  // 这里根据“日期”表头定位日历行，后续所有日期列都从这一行推导。
  const headerRow = matrix.find((row) => Array.isArray(row) && row.includes("日期"));
  if (!headerRow) {
    throw new Error("排班表里没有找到“日期”表头，无法定位日期列。");
  }

  return headerRow;
}

function findEmployeeRow(matrix, employeeName) {
  // 这里按员工姓名定位整行排班，确保后面取班次时不会错行。
  const employeeRow = matrix.find((row) => Array.isArray(row) && row.includes(employeeName));
  if (!employeeRow) {
    throw new Error(`排班表里没有找到员工「${employeeName}」所在行。`);
  }

  return employeeRow;
}

function findDateColumnIndex(headerRow, targetDate) {
  // 这里按“日”数字定位当天列，避免硬编码列号导致跨月直接失效。
  const dayText = String(targetDate.getDate());
  const dateColumnIndex = headerRow.findIndex((cell) => String(cell || "").trim() === dayText);

  if (dateColumnIndex < 0) {
    throw new Error(`排班表里没有找到「${dayText}」号对应的日期列。`);
  }

  return dateColumnIndex;
}

function normalizeShiftCode(rawShift) {
  // 这里把排班缩写统一翻译成人能直接看的中文结论。
  const shiftCode = String(rawShift || "").trim();

  if (!shiftCode) {
    return "休息";
  }

  const shiftLabelMap = {
    早: "早班",
    晚: "晚班",
    年: "年假",
    行: "行政"
  };

  return shiftLabelMap[shiftCode] || shiftCode;
}

const SCHEDULE_STRUCTURE_LABELS = new Set([
  "日期",
  "星期",
  "月份",
  "职务",
  "售前",
  "售后",
  "早班",
  "晚班",
  "休息",
  "年假",
  "行政",
  "剩余",
  "实到",
  "应到",
  "备注",
  "上班人数"
]);

function isScheduleStructureLabel(name) {
  // 这里识别排班表里的表头/汇总行标签，避免把「月份」「上班人数」这类结构行当成员工。
  return SCHEDULE_STRUCTURE_LABELS.has(String(name || "").trim());
}

function buildDailyShiftMap(matrix, targetDate) {
  // 这里把整张月排班表压成“姓名 -> 当天班次”映射，方便上层一次性判断整批值班客服。
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new Error("排班表数据为空，无法构建当日班次映射。");
  }

  const headerRow = findDateHeaderRow(matrix);
  const employeeNameColumnIndex = headerRow.findIndex((cell) => String(cell || "").trim() === "日期");
  if (employeeNameColumnIndex < 0) {
    throw new Error("排班表里没有找到员工姓名列，无法构建当日班次映射。");
  }

  const dateColumnIndex = findDateColumnIndex(headerRow, targetDate);
  const shiftMap = {};

  for (const row of matrix) {
    if (!Array.isArray(row) || row.length <= employeeNameColumnIndex) {
      continue;
    }

    const employeeName = String(row[employeeNameColumnIndex] || "").trim();
    if (!employeeName || isScheduleStructureLabel(employeeName)) {
      continue;
    }

    const rawShift = String(row[dateColumnIndex] || "").trim();
    shiftMap[employeeName] = {
      employeeName,
      rawShift,
      normalizedShift: normalizeShiftCode(rawShift)
    };
  }

  return shiftMap;
}

function matrixToTsv(matrix) {
  // 这里把二维表格统一导出成 TSV 文本，方便做本地快照留痕与人工复核。
  return matrix
    .map((row) => row.map((cell) => String(cell || "")).join("\t"))
    .join("\r\n");
}

function extractShiftFromMatrix(matrix, employeeName, targetDate) {
  // 这里从整张工作表矩阵里精确提取某人某天的排班结果。
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new Error("排班表数据为空，无法解析班次。");
  }

  const headerRow = findDateHeaderRow(matrix);
  const employeeRow = findEmployeeRow(matrix, employeeName);
  const dateColumnIndex = findDateColumnIndex(headerRow, targetDate);
  const rawShift = String(employeeRow[dateColumnIndex] || "").trim();

  return {
    sheetTitle: String(matrix[0] && matrix[0][0] ? matrix[0][0] : "").trim(),
    employeeName,
    day: targetDate.getDate(),
    dateColumnIndex,
    rawShift,
    normalizedShift: normalizeShiftCode(rawShift)
  };
}

module.exports = {
  buildDailyShiftMap,
  extractShiftFromMatrix,
  isScheduleStructureLabel,
  matrixToTsv,
  normalizeShiftCode,
  resolveMonthSheetName
};
