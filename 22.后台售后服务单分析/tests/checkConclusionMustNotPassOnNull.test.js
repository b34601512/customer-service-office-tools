// 反向断言（2026-09-22 实测事故锁死）：
// 当天 tmall2/tmall6 登录态失效 → 概览 stats 全是 null，但 checkTmallAllStores 仍打印
// 「✓ 全部门店都没有签收超 24h 未处理的单（无误漏）」；同时工具失败时还会复用上一轮的旧 JSON。
// 这两条假阴性都可能让人误以为“没有漏处理”，必须锁死：
//   1) null / 缺统计 / 工具失败 → 绝不允许得出「无误漏」；
//   2) 读数有效必须区分数字 0（真·没有单）和 null（根本没读到）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { 构建结论, 读数有效, 是本轮新数据 } = require("../scripts/checkTmallAllStores");

const stats全0 = {
  "24小时内待处理": 0, "待处理售后": 10, "退款待处理": 2, "待收货": 8,
  "待举证": 0, "小二已介入": 0, "商家已拒绝": 0, "超时同意退款": 0,
  "买家催促退款": 0, "待买家处理": 3, "退款处理时长(h)": "11.43"
};
const stats全null = Object.fromEntries(Object.keys(stats全0).map((key) => [key, null]));

test("数字 0 算有效，null 不算有效（两者不许混为一谈）", () => {
  assert.strictEqual(读数有效(0), true);
  assert.strictEqual(读数有效(null), false);
  assert.strictEqual(读数有效(undefined), false);
  assert.strictEqual(读数有效("12"), false);
});

test("全店读到 null 时绝不允许下「无误漏」结论", () => {
  const rows = [
    { name: "德达旗舰店", ok: false, stats: stats全null },
    { name: "DEDAKJ旗舰店", ok: false, stats: stats全null }
  ];
  const 结论 = 构建结论(rows);
  assert.strictEqual(结论.ok, false);
  assert.doesNotMatch(结论.text, /无误漏/);
  assert.match(结论.text, /不能下“无漏”结论/);
});

test("回归 2026-09-22 现场：一家真·0 + 一家 null → 仍不许报无漏", () => {
  const rows = [
    { name: "德达旗舰店", ok: true, stats: stats全0 },
    { name: "DEDAKJ旗舰店", ok: false, stats: stats全null }
  ];
  const 结论 = 构建结论(rows);
  assert.strictEqual(结论.ok, false);
  assert.doesNotMatch(结论.text, /无误漏/);
});

test("工具失败（连 stats 都没有）也不许报无漏", () => {
  const 结论 = 构建结论([{ name: "德迩杰旗舰店", ok: false, stats: {}, checkedAt: null, reason: "connect ECONNREFUSED" }]);
  assert.strictEqual(结论.ok, false);
  assert.doesNotMatch(结论.text, /无误漏/);
});

test("真·全部为 0 才报无误漏", () => {
  const rows = [
    { name: "德达旗舰店", ok: true, stats: stats全0 },
    { name: "DEDAKJ旗舰店", ok: true, stats: stats全0 },
    { name: "德迩杰旗舰店", ok: true, stats: stats全0 }
  ];
  const 结论 = 构建结论(rows);
  assert.strictEqual(结论.ok, true);
  assert.match(结论.text, /无误漏/);
});

test("有店 24小时内待处理 > 0 → 报临近超时", () => {
  const rows = [{ name: "德达旗舰店", ok: true, stats: { ...stats全0, "24小时内待处理": 3 } }];
  const 结论 = 构建结论(rows);
  assert.strictEqual(结论.ok, false);
  assert.match(结论.text, /临近超时/);
});

test("上一轮遗留的旧概览文件不算本轮数据", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmall-overview-"));
  const file = path.join(dir, "概览-tmall2.json");
  fs.writeFileSync(file, "{}");
  const 旧时间 = Date.now() - 60 * 60 * 1000;
  fs.utimesSync(file, new Date(旧时间), new Date(旧时间));
  assert.strictEqual(是本轮新数据(file, Date.now()), false, "1 小时前的旧文件必须被判为非本轮");
  assert.strictEqual(是本轮新数据(path.join(dir, "不存在.json"), Date.now()), false);
  assert.strictEqual(是本轮新数据(file, 旧时间 - 5000), true, "本轮刚写的文件要认");
  fs.rmSync(dir, { recursive: true, force: true });
});
