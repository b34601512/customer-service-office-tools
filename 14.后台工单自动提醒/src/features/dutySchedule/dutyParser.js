// 本文件是值班表纯函数解析层（不依赖浏览器）：排班矩阵 → 当日售后班次 + 当前时段在班人。
// 排班表结构依据实测：B 列是姓名，A 列职务（售前/售后，只在组首行出现），表头行含“日期”，日期列按“日”定位。

function monthSheetName(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function parseMinutes(timeText) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeText || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function nowMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// 班次代码归一：实测表内取值 早/晚/行/年/空；空=休息。
function normalizeShift(raw) {
  const code = String(raw || "").trim();
  if (code === "早") return "早班";
  if (code === "晚") return "晚班";
  if (code === "行") return "行政";
  if (code === "年") return "年假";
  if (!code) return "休息";
  return code;
}

// 从矩阵提取指定日期的值班名单（含职务组、班次、色块格坐标）；colors 由浏览器层回填：key=`${r},${c}` → rgb 或 null。
function buildTodayDuty(matrix, date, colors = {}, groupFilter = "售后") {
  const headerRowIdx = matrix.findIndex((row) => Array.isArray(row) && row.includes("日期"));
  if (headerRowIdx < 0) {
    throw new Error("排班表里没有找到“日期”表头，无法定位日期列。");
  }
  const headerRow = matrix[headerRowIdx];
  const dayCol = headerRow.findIndex(
    (cell, index) => index >= 2 && String(cell || "").trim() === String(date.getDate())
  );
  if (dayCol < 0) {
    throw new Error(`排班表里没有找到「${date.getDate()}」号列，无法确定当日班次。`);
  }

  const staff = [];
  let currentGroup = "";
  const SUMMARY_LABELS = ["早班", "晚班", "休息", "上班人数", "备注"];
  for (let r = 0; r < matrix.length; r += 1) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    const groupCell = String(row[0] || "").trim();
    // 汇总区（早班/晚班/休息 计数行）：col0 是结构标签，整行跳过，不当员工也不改组
    if (SUMMARY_LABELS.includes(groupCell)) continue;
    if (["售前", "售后"].includes(groupCell)) currentGroup = groupCell;
    const name = String(row[1] || "").trim();
    if (!name || name === "星期" || currentGroup !== groupFilter) continue;
    if (SUMMARY_LABELS.includes(name)) continue;
    if (/^\d+(\.\d+)?$/.test(name)) continue; // 汇总区偶有数字落在姓名列
    const shift = normalizeShift(row[dayCol]);
    const colorKey = `${r},${dayCol}`;
    staff.push({ name, group: currentGroup, shift, colorKey, colorRgb: colors[colorKey] || null });
  }
  if (staff.length === 0) {
    throw new Error(`排班表「${groupFilter}」组里没有解析到任何员工行。`);
  }
  return { dayCol, staff };
}

// 当前时段在班：早班 [earlyStart, earlyEnd)，晚班 [lateStart, lateEnd)。14:00~16:30 双班重叠都算在班。
function listOnDutyNow(staff, windows, date) {
  const minutes = nowMinutes(date);
  return staff.filter((item) => {
    if (item.shift === "早班") {
      return minutes >= parseMinutes(windows.earlyStart) && minutes < parseMinutes(windows.earlyEnd);
    }
    if (item.shift === "晚班") {
      return minutes >= parseMinutes(windows.lateStart) && minutes < parseMinutes(windows.lateEnd);
    }
    return false;
  });
}

// rgb → 人话颜色：查配置色名表，命中给名字，未命中显示原色值（空=无底色由文案层决定表述）。
function describeColor(colorRgb, colorNames) {
  if (!colorRgb) return "";
  const key = String(colorRgb).toUpperCase();
  return colorNames[key] || colorNames[key.replace(/^#/, "")] || key;
}

module.exports = { monthSheetName, buildTodayDuty, listOnDutyNow, describeColor, normalizeShift, parseMinutes };
