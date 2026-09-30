const test = require("node:test");
const assert = require("node:assert");
const { 挑值班, 从报告挑值班 } = require("../src/lib/值班");

const 配置 = {
  颜色分组: { "#BDD7EE": "售后", "#E2F0D9": "售前" },
  分组名单: {
    售后: {
      李守耀: { userId: "u-lead", userName: "李守耀（售后组长）" },
      邓远祥: { userId: "u-deng", userName: "邓远祥（售后客服）" },
      柯紫婷: { userId: "u-ke", userName: "柯紫婷（售后客服）" },
    },
    售前: {
      韩欢欢: { userId: "u-han", userName: "韩欢欢（售前客服）" },
    },
  },
};

test("挑值班：唯一带底色的售后 ⇒ 挑中（09-29 实况：邓远祥 #BDD7EE）", () => {
  const 人 = [
    { 姓名: "徐佳楠", 底色: "#E2F0D9", 班次: "早班" },
    { 姓名: "刘秀文", 底色: "#E2F0D9", 班次: "晚班" },
    { 姓名: "邓远祥", 底色: "#BDD7EE", 班次: "晚班" },
  ];
  const r = 挑值班(人, "售后", 配置);
  assert.equal(r.found, true);
  assert.equal(r.姓名, "邓远祥");
  assert.equal(r.userId, "u-deng");
  assert.match(r.理由, /BDD7EE/);
});

test("挑值班：没带底色的售后 ⇒ 不找（不猜、不兜底组长）", () => {
  const r = 挑值班([{ 姓名: "李守耀", 底色: "#FFFFFF" }, { 姓名: "徐佳楠", 底色: "#E2F0D9" }], "售后", 配置);
  assert.equal(r.found, false);
  assert.equal(r.userId, null);
  assert.match(r.理由, /一个也没有/);
});

test("挑值班：同分组 ≥2 人带底色 ⇒ 判分不清（返回候选，不许随便挑）", () => {
  const r = 挑值班([{ 姓名: "邓远祥", 底色: "#BDD7EE" }, { 姓名: "柯紫婷", 底色: "#BDD7EE" }], "售后", 配置);
  assert.equal(r.found, false);
  assert.deepEqual(r.候选, ["邓远祥", "柯紫婷"]);
  assert.match(r.理由, /请人工指定/);
});

test("挑值班：售前只看售前（售后底色不会串到售前）", () => {
  const 人 = [{ 姓名: "邓远祥", 底色: "#BDD7EE" }, { 姓名: "韩欢欢", 底色: "#E2F0D9" }];
  assert.equal(挑值班(人, "售前", 配置).姓名, "韩欢欢");
  assert.equal(挑值班(人, "售后", 配置).姓名, "邓远祥");
});

test("挑值班：名单里没有 userid ⇒ 明确报错让补（不许派给空 id）", () => {
  const 配置2 = { 分组名单: { 售后: { 缪婷婷: { userName: "缪婷婷（售后客服）" } } } };
  const r = 挑值班([{ 姓名: "缪婷婷", 底色: "#BDD7EE" }], "售后", 配置2);
  assert.equal(r.found, false);
  assert.match(r.理由, /没有 userid/);
});

test("挑值班：空输入 / 空名单都不炸", () => {
  assert.equal(挑值班([], "售后", 配置).found, false);
  assert.equal(挑值班(undefined, "售后", 配置).found, false);
  assert.equal(挑值班([{ 姓名: "邓远祥", 底色: "#BDD7EE" }], "售后", {}).found, false);
});

test("从报告挑值班：直接吃 20号 的 schedule-report.json 结构", () => {
  const 报告 = { 日期: "2026-09-30", 当日有色人员: [{ 姓名: "韩欢欢", 底色: "#E2F0D9" }, { 姓名: "缪婷婷", 底色: "#BDD7EE" }] };
  assert.equal(从报告挑值班(报告, "售后", 配置).found, false); // 缪婷婷不在测试配置名单里
  const 配置3 = { 分组名单: { 售后: { 缪婷婷: { userId: "u-miao", userName: "缪婷婷（售后客服）" } } } };
  assert.equal(从报告挑值班(报告, "售后", 配置3).userName, "缪婷婷（售后客服）");
});
