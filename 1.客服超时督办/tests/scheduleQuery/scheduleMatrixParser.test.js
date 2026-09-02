const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDailyShiftMap,
  extractShiftFromMatrix,
  matrixToTsv,
  normalizeShiftCode,
  resolveMonthSheetName
} = require("../../src/features/scheduleQuery/scheduleMatrixParser");

const sampleMatrix = [
  ["2026年3月客服排班表"],
  ["", "日期", "24", "25", "26"],
  ["职务", "星期", "一", "二", "三"],
  ["售前", "易凡", "", "早", "晚"],
  ["售后", "苏哲", "晚", "", "早"]
];

test("应该能解析出易凡在指定日期的班次", () => {
  const result = extractShiftFromMatrix(sampleMatrix, "易凡", new Date(2026, 2, 25));

  assert.equal(result.sheetTitle, "2026年3月客服排班表");
  assert.equal(result.employeeName, "易凡");
  assert.equal(result.rawShift, "早");
  assert.equal(result.normalizedShift, "早班");
});

test("空白排班应该被识别为休息", () => {
  const result = extractShiftFromMatrix(sampleMatrix, "苏哲", new Date(2026, 2, 25));

  assert.equal(result.rawShift, "");
  assert.equal(result.normalizedShift, "休息");
});

test("应该能把排班缩写和月份名称转换成统一格式", () => {
  assert.equal(resolveMonthSheetName(new Date(2026, 2, 25)), "2026年3月");
  assert.equal(normalizeShiftCode("晚"), "晚班");
  assert.equal(normalizeShiftCode(""), "休息");
  assert.equal(
    matrixToTsv(sampleMatrix),
    [
      "2026年3月客服排班表",
      "\t日期\t24\t25\t26",
      "职务\t星期\t一\t二\t三",
      "售前\t易凡\t\t早\t晚",
      "售后\t苏哲\t晚\t\t早"
    ].join("\r\n")
  );
});

test("应该能构建出当天全员班次映射", () => {
  const shiftMap = buildDailyShiftMap(sampleMatrix, new Date(2026, 2, 25));

  assert.deepEqual(shiftMap["易凡"], {
    employeeName: "易凡",
    rawShift: "早",
    normalizedShift: "早班"
  });
  assert.deepEqual(shiftMap["苏哲"], {
    employeeName: "苏哲",
    rawShift: "",
    normalizedShift: "休息"
  });
});

test("表头/汇总结构行（月份、早班、休息、上班人数等）不应该被当成员工", () => {
  const realMatrix = [
    ["2026年8月客服排班表"],
    ["月份", "日期", "24", "25", "26"],
    ["职务", "星期", "一", "二", "三"],
    ["售前", "易凡", "", "早", "晚"],
    ["售后", "卢安", "早", "", "晚"],
    ["", "早班", "2", "3", "2"],
    ["", "上班人数", "2", "3", "2"]
  ];
  const shiftMap = buildDailyShiftMap(realMatrix, new Date(2026, 7, 25));

  assert.deepEqual(Object.keys(shiftMap).sort(), ["卢安", "易凡"]);
  assert.equal(shiftMap["月份"], undefined);
  assert.equal(shiftMap["早班"], undefined);
  assert.equal(shiftMap["上班人数"], undefined);
});
