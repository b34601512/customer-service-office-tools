// 值班@链路测试：排班矩阵解析、时段在班判定、@计划组装（纯函数，不碰浏览器）。
const test = require("node:test");
const assert = require("node:assert");
const {
  monthSheetName, buildTodayDuty, listOnDutyNow, describeColor, normalizeShift
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
  ["休息", "", ""],
  ["早班", "3", ""],
  ["晚班", "2", ""]
];
// 当日列=日期3 → 列下标 4；色格 key 为 `行,4`
const COLORS = { "5,4": null, "6,4": "#BDD7EE", "7,4": "#FFFFFF" };
const DATE_DAY3 = new Date(2026, 8, 3);

test("月份工作表名", () => {
  assert.strictEqual(monthSheetName(new Date(2026, 8, 3)), "2026年9月");
});

test("班次归一", () => {
  assert.strictEqual(normalizeShift("早"), "早班");
  assert.strictEqual(normalizeShift(""), "休息");
  assert.strictEqual(normalizeShift("行"), "行政");
});

test("解析当日售后班次+底色，跳过售前与汇总区", () => {
  const { staff } = buildTodayDuty(MATRIX, DATE_DAY3, COLORS, "售后");
  assert.deepStrictEqual(staff.map((s) => s.name), ["李守耀", "缪婷婷", "柯紫婷"]);
  assert.strictEqual(staff[0].shift, "休息");
  assert.strictEqual(staff[1].shift, "晚班");
  assert.strictEqual(staff[1].colorRgb, "#BDD7EE");
  assert.strictEqual(staff[2].colorRgb, "#FFFFFF");
  assert.strictEqual(staff[0].colorRgb, null);
});

test("找不到日期列报中文错", () => {
  assert.throws(() => buildTodayDuty(MATRIX, new Date(2026, 8, 28), {}, "售后"), /没有找到「28」号列/);
});

const WINDOWS = { earlyStart: "08:00", earlyEnd: "16:30", lateStart: "14:00", lateEnd: "22:30" };
const staffAt = (shift) => [{ name: `某${shift}`, shift }];

test("时段在班：早班08:00在班，16:30后不在", () => {
  assert.strictEqual(listOnDutyNow(staffAt("早班"), WINDOWS, new Date(2026, 8, 3, 8, 0)).length, 1);
  assert.strictEqual(listOnDutyNow(staffAt("早班"), WINDOWS, new Date(2026, 8, 3, 16, 29)).length, 1);
  assert.strictEqual(listOnDutyNow(staffAt("早班"), WINDOWS, new Date(2026, 8, 3, 16, 30)).length, 0);
});

test("时段在班：晚班14:00重叠段双班都算，22:30收班", () => {
  const both = [{ name: "早", shift: "早班" }, { name: "晚", shift: "晚班" }];
  assert.deepStrictEqual(listOnDutyNow(both, WINDOWS, new Date(2026, 8, 3, 15, 0)).map((s) => s.name), ["早", "晚"]);
  assert.deepStrictEqual(listOnDutyNow(both, WINDOWS, new Date(2026, 8, 3, 22, 30)).map((s) => s.name), []);
});

test("颜色描述查表，未命中显示原值", () => {
  assert.strictEqual(describeColor("#BDD7EE", { "#BDD7EE": "浅蓝" }), "浅蓝");
  assert.strictEqual(describeColor("#123456", {}), "#123456");
  assert.strictEqual(describeColor(null, { "#BDD7EE": "浅蓝" }), "");
});

const CONFIG = {
  duty: {
    group: "售后",
    managerNames: ["黎路遥"],
    colorNames: { "#BDD7EE": "浅蓝", "#FFFFFF": "白色" }
  },
  wecom: { memberMobileMap: { "李守耀": "18923872211", "黎路遥": "19925378376" } }
};

test("值班成功→在班人+主管进@名单，底色写进文案行", () => {
  const plan = buildMentionPlan(CONFIG, {
    ok: true,
    todayStaff: [
      { name: "李守耀", shift: "早班", colorRgb: null, colorName: "" },
      { name: "缪婷婷", shift: "晚班", colorRgb: "#BDD7EE", colorName: "浅蓝" }
    ],
    onDutyNow: ["李守耀"]
  });
  assert.deepStrictEqual(plan.atNames, ["李守耀", "黎路遥"]);
  assert.deepStrictEqual(plan.mobiles, ["18923872211", "19925378376"]);
  assert.match(plan.todayLine, /缪婷婷（晚班·浅蓝底）/);
  assert.match(plan.todayLine, /李守耀（早班·无底色）/);
  assert.match(plan.onDutyLine, /当前在班：李守耀/);
});

test("排班读取失败→只@主管并说明原因", () => {
  const plan = buildMentionPlan(CONFIG, { ok: false, todayStaff: [], onDutyNow: [], error: "网络超时" });
  assert.deepStrictEqual(plan.atNames, ["黎路遥"]);
  assert.deepStrictEqual(plan.mobiles, ["19925378376"]);
  assert.match(plan.todayLine, /排班读取失败.*网络超时/);
});
