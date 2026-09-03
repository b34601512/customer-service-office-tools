// 值班@链路测试：排班矩阵解析、按天@规则（组长在班就@组长；其他人看背景标记色）、@计划组装。纯函数，不碰浏览器。
const test = require("node:test");
const assert = require("node:assert");
const {
  monthSheetName, buildTodayDuty, selectAtStaff, describeColor, normalizeShift, isWorkingShift
} = require("../src/features/dutySchedule/dutyParser");
const { buildMentionPlan } = require("../src/features/dutySchedule/dutyService");

// 模拟真实排班矩阵：A列职务组首行标注，B列姓名，第2行是“日期”表头，日期1..5 从C列起。
const MATRIX = [
  ["", "客服部排班表", ""],
  ["职务", "日期", 1, 2, 3, 4, 5],
  ["", "星期", "二", "三", "四", "五", "六"],
  ["售前", "韩欢欢", "早", "", "早", "早", "晚"],
  ["", "麦诺谦", "晚", "晚", "", "晚", "早"],
  ["售后", "李守耀", "早", "早", "", "", "早"],
  ["", "缪婷婷", "", "晚", "晚", "早", "晚"],
  ["", "柯紫婷", "晚", "行", "晚", "", "早"],
  ["", "陈燕玲", "早", "", "晚", "晚", "休"],
  ["休息", "", ""],
  ["早班", "3", ""],
  ["晚班", "2", ""]
];
// 当日列=日期3 → 列下标 4；色格 key 为 `行,4`
const COLORS = {
  "5,4": "#FFFFFF",  // 李守耀 休息日仍白底
  "6,4": "#BDD7EE",  // 缪婷婷 晚班 浅蓝标记
  "7,4": "#FFFFFF",  // 柯紫婷 晚班 无标记
  "8,4": "#BDD7EE"   // 陈燕玲 晚班 浅蓝标记
};
const DATE_DAY3 = new Date(2026, 8, 3);

test("月份工作表名", () => {
  assert.strictEqual(monthSheetName(new Date(2026, 8, 3)), "2026年9月");
});

test("班次归一", () => {
  assert.strictEqual(normalizeShift("早"), "早班");
  assert.strictEqual(normalizeShift(""), "休息");
  assert.strictEqual(normalizeShift("行"), "行政");
  assert.strictEqual(isWorkingShift("行政"), false);
});

test("解析当日售后班次+底色，跳过售前与汇总区", () => {
  const { staff } = buildTodayDuty(MATRIX, DATE_DAY3, COLORS, "售后");
  assert.deepStrictEqual(staff.map((s) => s.name), ["李守耀", "缪婷婷", "柯紫婷", "陈燕玲"]);
  assert.strictEqual(staff[0].shift, "休息");
  assert.strictEqual(staff[1].colorRgb, "#BDD7EE");
});

test("找不到日期列报中文错", () => {
  assert.throws(() => buildTodayDuty(MATRIX, new Date(2026, 8, 28), {}, "售后"), /没有找到「28」号列/);
});

const withColor = (list) => list.map((s) => ({
  ...s,
  colorName: describeColor(s.colorRgb, { "#BDD7EE": "浅蓝", "#FFFFFF": "白色", "#FFFF00": "黄色" })
}));

test("组长当日在班→只@组长（白底不算标记）", () => {
  const staff = withColor([
    { name: "李守耀", shift: "早班", colorRgb: "#FFFFFF" },
    { name: "柯紫婷", shift: "晚班", colorRgb: "#FFFFFF" }
  ]);
  const at = selectAtStaff(staff, { leadNames: ["李守耀"], nonMarkerColors: ["#FFFFFF"] });
  assert.deepStrictEqual(at.map((a) => a.name), ["李守耀"]);
  assert.strictEqual(at[0].reason, "组长值班");
});

test("组长休息→不@组长；有标记色售后按标记@", () => {
  const staff = withColor([
    { name: "李守耀", shift: "休息", colorRgb: "#FFFF00" },
    { name: "缪婷婷", shift: "晚班", colorRgb: "#BDD7EE" },
    { name: "柯紫婷", shift: "早班", colorRgb: null },
    { name: "陈燕玲", shift: "休息", colorRgb: "#BDD7EE" } // 休息即使有标记也不@
  ]);
  const at = selectAtStaff(staff, { leadNames: ["李守耀"], nonMarkerColors: ["#FFFFFF"] });
  assert.deepStrictEqual(at.map((a) => a.name), ["缪婷婷"]);
  assert.strictEqual(at[0].reason, "浅蓝底标记");
});

test("组长+标记人同时@（组长在班不互斥其他人标记）", () => {
  const staff = withColor([
    { name: "李守耀", shift: "早班", colorRgb: "#FFFFFF" },
    { name: "陈燕玲", shift: "晚班", colorRgb: "#BDD7EE" }
  ]);
  const at = selectAtStaff(staff, { leadNames: ["李守耀"], nonMarkerColors: ["#FFFFFF"] });
  assert.deepStrictEqual(at.map((a) => a.name), ["李守耀", "陈燕玲"]);
});

test("颜色描述查表，未命中显示原值", () => {
  assert.strictEqual(describeColor("#BDD7EE", { "#BDD7EE": "浅蓝" }), "浅蓝");
  assert.strictEqual(describeColor("#123456", {}), "#123456");
  assert.strictEqual(describeColor(null, { "#BDD7EE": "浅蓝" }), "");
});

const CONFIG = {
  duty: {
    group: "售后",
    leadNames: ["李守耀"],
    managerNames: ["黎路遥"],
    colorNames: { "#BDD7EE": "浅蓝", "#FFFFFF": "白色" }
  },
  wecom: { memberMobileMap: { "李守耀": "18923872211", "陈燕玲": "13923800587", "黎路遥": "19925378376" } }
};

test("@计划：组长+标记人+主管，@行写清原因", () => {
  const plan = buildMentionPlan(CONFIG, {
    ok: true,
    todayStaff: [
      { name: "李守耀", shift: "早班", colorRgb: "#FFFFFF", colorName: "白色" },
      { name: "陈燕玲", shift: "晚班", colorRgb: "#BDD7EE", colorName: "浅蓝" }
    ],
    atStaff: [
      { name: "李守耀", reason: "组长值班" },
      { name: "陈燕玲", reason: "浅蓝底标记" }
    ]
  });
  assert.deepStrictEqual(plan.atNames, ["李守耀", "陈燕玲", "黎路遥"]);
  assert.deepStrictEqual(plan.mobiles, ["18923872211", "13923800587", "19925378376"]);
  assert.match(plan.onDutyLine, /本次@：李守耀（组长值班）、陈燕玲（浅蓝底标记）/);
  assert.ok(!("todayLine" in plan), "群文案不再有全员值班长行");
});

test("排班读取失败→只@主管并说明原因", () => {
  const plan = buildMentionPlan(CONFIG, { ok: false, todayStaff: [], atStaff: [], error: "网络超时" });
  assert.deepStrictEqual(plan.atNames, ["黎路遥"]);
  assert.deepStrictEqual(plan.mobiles, ["19925378376"]);
  assert.match(plan.onDutyLine, /排班读取失败.*网络超时.*只@主管/);
});
