const test = require("node:test");
const assert = require("node:assert");
const { 挑值班, 从报告挑值班 } = require("../src/lib/值班");

const 配置 = {
  颜色分组: { "#BDD7EE": "售后", "#E2F0D9": "售前" },
  分组名单: {
    售后: {
      李某某: { userId: "u-lead", userName: "李某某（售后组长）" },
      邓某某: { userId: "u-deng", userName: "邓某某（售后客服）" },
      柯某某: { userId: "u-ke", userName: "柯某某（售后客服）" },
      陈某某: { userId: "u-chen", userName: "陈某某（售后客服）" },
    },
    售前: {
      韩某某: { userId: "u-han", userName: "韩某某（售前客服）" },
    },
  },
};

const 时刻 = (s) => new Date(`2026-10-05T${s}:00`);

// 10-05 真实班次映射（节选）：组长李某某早班（无色）；邓某某晚班带 #BDD7EE
const 班次映射 = {
  李某某: { employeeName: "李某某", normalizedShift: "早班", backgroundColor: "" },
  邓某某: { employeeName: "邓某某", normalizedShift: "晚班", backgroundColor: "#BDD7EE" },
  陈某某: { employeeName: "陈某某", normalizedShift: "休息", backgroundColor: "#FFFF00" },
};
const 当日有色 = [
  { 姓名: "麦某某", 底色: "#E2F0D9", 班次: "晚班" },
  { 姓名: "叶某某", 底色: "#E2F0D9", 班次: "早班" },
  { 姓名: "刘某某", 底色: "#DEEBF7", 班次: "休息" },
  { 姓名: "邓某某", 底色: "#BDD7EE", 班次: "晚班" },
  { 姓名: "陈某某", 底色: "#FFFF00", 班次: "休息" },
];

test("组长优先级（用户 2026-10-05）：组长在班就是他负责值班——哪怕别人带着底色", () => {
  // 10-05 09:25：李某某（组长、早班、无色）在班；邓某某（晚班、带色）还没上班 ⇒ 挑组长
  const r = 挑值班(当日有色, "售后", 配置, { 当前时间: 时刻("09:25"), 班次映射 });
  assert.equal(r.found, true);
  assert.equal(r.姓名, "李某某");
  assert.equal(r.userId, "u-lead");
  assert.match(r.理由, /组长/);
  assert.match(r.理由, /在岗/);

  // 17:00：组长（早班 16:00 下班）不在班 ⇒ 才轮到带底色的邓某某
  const r2 = 挑值班(当日有色, "售后", 配置, { 当前时间: 时刻("17:00"), 班次映射 });
  assert.equal(r2.found, true);
  assert.equal(r2.姓名, "邓某某");
});

test("10-05 23:00（组长、邓某某都下班）⇒ 不挑，报「请人工指定」", () => {
  const r = 挑值班(当日有色, "售后", 配置, { 当前时间: 时刻("23:00"), 班次映射 });
  assert.equal(r.found, false);
  assert.equal(r.userId, null);
  assert.deepEqual(r.候选, ["邓某某"]);
  assert.match(r.理由, /此刻/);
  assert.match(r.理由, /晚班/);
  assert.match(r.理由, /请人工指定/);
});

test("挑值班：唯一带底色的售后且此刻在班 ⇒ 挑中（09-29 实况：邓某某 #BDD7EE 晚班）", () => {
  const 人 = [
    { 姓名: "徐某某", 底色: "#E2F0D9", 班次: "早班" },
    { 姓名: "刘某某", 底色: "#E2F0D9", 班次: "晚班" },
    { 姓名: "邓某某", 底色: "#BDD7EE", 班次: "晚班" },
  ];
  const r = 挑值班(人, "售后", 配置, { 当前时间: 时刻("20:00") });
  assert.equal(r.found, true);
  assert.equal(r.姓名, "邓某某");
  assert.equal(r.userId, "u-deng");
  assert.match(r.理由, /BDD7EE/);
  assert.match(r.理由, /在岗/);
});

test("挑值班：10-01 实况（陈某某 早班 + 邓某某 晚班 都带底色）——18:15 挑晚班的邓某某", () => {
  const 人 = [
    { 姓名: "陈某某", 底色: "#BDD7EE", 班次: "早班" },
    { 姓名: "邓某某", 底色: "#BDD7EE", 班次: "晚班" },
  ];
  const r = 挑值班(人, "售后", 配置, { 当前时间: 时刻("18:15") });
  assert.equal(r.found, true);
  assert.equal(r.姓名, "邓某某");
});

test("挑值班：10-01 实况——15:00（早、晚都在班）⇒ 判分不清", () => {
  const 人 = [
    { 姓名: "陈某某", 底色: "#BDD7EE", 班次: "早班" },
    { 姓名: "邓某某", 底色: "#BDD7EE", 班次: "晚班" },
  ];
  const r = 挑值班(人, "售后", 配置, { 当前时间: 时刻("15:00") });
  assert.equal(r.found, false);
  assert.deepEqual(r.候选, ["陈某某", "邓某某"]);
});

test("挑值班：带底色但班次是休息 ⇒ 不在岗（不挑）", () => {
  const r = 挑值班([{ 姓名: "邓某某", 底色: "#BDD7EE", 班次: "休息" }], "售后", 配置, { 当前时间: 时刻("10:00") });
  assert.equal(r.found, false);
  assert.match(r.理由, /没有一人在其班次时段内/);
});

test("挑值班：班次缺失/未知 ⇒ 不在岗，不猜", () => {
  assert.equal(挑值班([{ 姓名: "邓某某", 底色: "#BDD7EE" }], "售后", 配置, { 当前时间: 时刻("10:00") }).found, false);
  assert.equal(挑值班([{ 姓名: "邓某某", 底色: "#BDD7EE", 班次: "中班" }], "售后", 配置, { 当前时间: 时刻("10:00") }).found, false);
});

test("挑值班：配置可覆盖班次时间（晚班改 10:00-12:00 ⇒ 11:00 在岗）", () => {
  const 配置2 = { ...配置, 班次时间: { 售后: { 晚班: ["10:00", "12:00"] } } };
  const r = 挑值班([{ 姓名: "邓某某", 底色: "#BDD7EE", 班次: "晚班" }], "售后", 配置2, { 当前时间: 时刻("11:00") });
  assert.equal(r.found, true);
  assert.equal(r.姓名, "邓某某");
});

test("没带底色的售后：组长在班 ⇒ 挑组长（10-05 口径）；组长不在班 ⇒ 一个也没有（不猜）", () => {
  const 人 = [
    { 姓名: "李某某", 底色: "#FFFFFF", 班次: "早班" },
    { 姓名: "徐某某", 底色: "#E2F0D9", 班次: "早班" },
  ];
  const 在班 = 挑值班(人, "售后", 配置, { 当前时间: 时刻("10:00") });
  assert.equal(在班.found, true);
  assert.equal(在班.姓名, "李某某");
  const 下班 = 挑值班(人, "售后", 配置, { 当前时间: 时刻("20:00") });
  assert.equal(下班.found, false);
  assert.equal(下班.userId, null);
  assert.match(下班.理由, /一个也没有/);
});

test("挑值班：售前只看售前（售后底色不会串到售前；售前没有配置组长）", () => {
  const 人 = [{ 姓名: "邓某某", 底色: "#BDD7EE", 班次: "早班" }, { 姓名: "韩某某", 底色: "#E2F0D9", 班次: "早班" }];
  assert.equal(挑值班(人, "售前", 配置, { 当前时间: 时刻("10:00") }).姓名, "韩某某");
  assert.equal(挑值班(人, "售后", 配置, { 当前时间: 时刻("10:00") }).姓名, "邓某某");
});

test("挑值班：名单里没有 userid ⇒ 明确报错让补（不许派给空 id）", () => {
  const 配置2 = { 分组名单: { 售后: { 缪某某: { userName: "缪某某（售后客服）" } } } };
  const r = 挑值班([{ 姓名: "缪某某", 底色: "#BDD7EE", 班次: "早班" }], "售后", 配置2, { 当前时间: 时刻("10:00") });
  assert.equal(r.found, false);
  assert.match(r.理由, /没有 userid/);
});

test("挑值班：组长在配置里没 userid ⇒ 报错让补（不派空 id）", () => {
  const 配置2 = { 分组名单: { 售后: { 李某某: { userName: "李某某（售后组长）" } } } };
  const r = 挑值班([], "售后", 配置2, { 当前时间: 时刻("10:00"), 班次映射 });
  assert.equal(r.found, false);
  assert.match(r.理由, /没有 userid/);
});

test("挑值班：空输入 / 空名单都不炸", () => {
  assert.equal(挑值班([], "售后", 配置).found, false);
  assert.equal(挑值班(undefined, "售后", 配置).found, false);
  assert.equal(挑值班([{ 姓名: "邓某某", 底色: "#BDD7EE" }], "售后", {}).found, false);
});

test("从报告挑值班：吃 20号 report 结构（自动带「当日班次映射」判组长/在班）", () => {
  const 报告 = {
    日期: "2026-10-05",
    当日有色人员: 当日有色,
    当日班次映射: 班次映射,
  };
  assert.equal(从报告挑值班(报告, "售后", 配置, { 当前时间: 时刻("09:25") }).姓名, "李某某");
  assert.equal(从报告挑值班(报告, "售后", 配置, { 当前时间: 时刻("17:00") }).姓名, "邓某某");
  const 配置3 = { 分组名单: { 售后: { 缪某某: { userId: "u-miao", userName: "缪某某（售后客服）" } } } };
  const 报告2 = { 日期: "2026-09-30", 当日有色人员: [{ 姓名: "缪某某", 底色: "#BDD7EE", 班次: "早班" }] };
  assert.equal(从报告挑值班(报告2, "售后", 配置3, { 当前时间: 时刻("10:00") }).userName, "缪某某（售后客服）");
});
