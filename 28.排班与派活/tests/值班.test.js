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

test("挑值班：同一人 10-01 实况——15:00（早、晚都在班）⇒ 判分不清", () => {
  const 人 = [
    { 姓名: "陈某某", 底色: "#BDD7EE", 班次: "早班" },
    { 姓名: "邓某某", 底色: "#BDD7EE", 班次: "晚班" },
  ];
  const r = 挑值班(人, "售后", 配置, { 当前时间: 时刻("15:00") });
  assert.equal(r.found, false);
  assert.deepEqual(r.候选, ["陈某某", "邓某某"]);
});

test("挑值班：10-05 实况（只有邓某某 晚班带底色）——09:25 他还没上班 ⇒ 不挑、报「请人工指定」", () => {
  const 人 = [
    { 姓名: "麦某某", 底色: "#E2F0D9", 班次: "晚班" },
    { 姓名: "叶某某", 底色: "#E2F0D9", 班次: "早班" },
    { 姓名: "刘某某", 底色: "#DEEBF7", 班次: "休息" },
    { 姓名: "邓某某", 底色: "#BDD7EE", 班次: "晚班" },
    { 姓名: "陈某某", 底色: "#FFFF00", 班次: "休息" },
  ];
  const r = 挑值班(人, "售后", 配置, { 当前时间: 时刻("09:25") });
  assert.equal(r.found, false);
  assert.equal(r.userId, null);
  assert.deepEqual(r.候选, ["邓某某"]);
  assert.match(r.理由, /此刻/);
  assert.match(r.理由, /晚班/);
  assert.match(r.理由, /请人工指定/);
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

test("挑值班：没带底色的售后 ⇒ 不找（不猜、不兜底组长）", () => {
  const 人 = [
    { 姓名: "李某某", 底色: "#FFFFFF", 班次: "早班" },
    { 姓名: "徐某某", 底色: "#E2F0D9", 班次: "早班" },
  ];
  const r = 挑值班(人, "售后", 配置, { 当前时间: 时刻("10:00") });
  assert.equal(r.found, false);
  assert.equal(r.userId, null);
  assert.match(r.理由, /一个也没有/);
});

test("挑值班：售前只看售前（售后底色不会串到售前）", () => {
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

test("挑值班：空输入 / 空名单都不炸", () => {
  assert.equal(挑值班([], "售后", 配置).found, false);
  assert.equal(挑值班(undefined, "售后", 配置).found, false);
  assert.equal(挑值班([{ 姓名: "邓某某", 底色: "#BDD7EE" }], "售后", {}).found, false);
});

test("从报告挑值班：直接吃 20号 的 schedule-report.json 结构（含此刻判定）", () => {
  const 报告 = { 日期: "2026-09-30", 当日有色人员: [{ 姓名: "韩某某", 底色: "#E2F0D9", 班次: "早班" }, { 姓名: "缪某某", 底色: "#BDD7EE", 班次: "早班" }] };
  assert.equal(从报告挑值班(报告, "售后", 配置, { 当前时间: 时刻("10:00") }).found, false); // 缪某某不在测试配置名单里
  const 配置3 = { 分组名单: { 售后: { 缪某某: { userId: "u-miao", userName: "缪某某（售后客服）" } } } };
  assert.equal(从报告挑值班(报告, "售后", 配置3, { 当前时间: 时刻("10:00") }).userName, "缪某某（售后客服）");
});
