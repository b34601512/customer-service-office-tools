// 本文件是值班表纯函数解析层（不依赖浏览器）：排班矩阵 → 当日售后班次与底色。
// @人规则（用户2026-09-03定，按天不按时刻）：组长当日有班就@组长；其他售后只看背景标记色，有标记色=值班。
// 排班表结构依据实测：B 列是姓名，A 列职务（售前/售后，只在组首行出现），表头行含“日期”，日期列按日定位。

function monthSheetName(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
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

// 当日在班（早/晚才算；行政/年假/休息不算）。
function isWorkingShift(shift) {
  return shift === "早班" || shift === "晚班";
}

// @名单选择（纯规则）：
// 1) 组长（leadNames）当日在班 → @组长（他负责总值班，只看他在不在，不看底色）。
// 2) 其他售后：当日在班 且 格上有背景标记色（非空、非 nonMarkerColors 名单内，默认排除白色） → @。
// 返回 [{name, reason, colorName}]，reason 写进文案供群里看懂为什么@他。
function selectAtStaff(staff, options) {
  const leadNames = options.leadNames || [];
  const nonMarker = (options.nonMarkerColors || ["#FFFFFF"]).map((c) => String(c).toUpperCase());
  const picked = [];
  for (const item of staff) {
    if (!isWorkingShift(item.shift)) continue;
    if (leadNames.includes(item.name)) {
      picked.push({ name: item.name, reason: "组长值班", colorName: item.colorName || "" });
      continue;
    }
    const rgb = item.colorRgb ? String(item.colorRgb).toUpperCase() : null;
    if (rgb && !nonMarker.includes(rgb)) {
      picked.push({ name: item.name, reason: `${item.colorName || rgb}底标记`, colorName: item.colorName || "" });
    }
  }
  return picked;
}

// rgb → 人话颜色：查配置色名表，命中给名字，未命中显示原色值（空=无底色由文案层决定表述）。
function describeColor(colorRgb, colorNames) {
  if (!colorRgb) return "";
  const key = String(colorRgb).toUpperCase();
  return colorNames[key] || colorNames[key.replace(/^#/, "")] || key;
}

module.exports = { monthSheetName, buildTodayDuty, isWorkingShift, selectAtStaff, describeColor, normalizeShift };
