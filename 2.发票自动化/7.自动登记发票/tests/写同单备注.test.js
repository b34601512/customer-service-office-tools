// 7号：写同单备注.js 的云端返回判据单测（离线，不触网、不碰真表）。
// 背景（失败台账 2026-10-05 观察项 → 2026-10-06 第 4 次复现，已成规律）：
//   旧代码按 `结果.status !== "已写入"` 判，而云端写入脚本（独立脚本 v2026-09-30.16）返回的是
//   `written:true/false`，从不带 status → 写成功也打印「状态=undefined」并置退出码 1。
// 这些断言把「判据只认 written===true」锁死：以后谁想退回去看 status（或按 mode 判）都会在这里红。
const test = require("node:test");
const assert = require("node:assert/strict");
const { 判定写入, 备注列 } = require("../scripts/写同单备注");

// 成功样例 = 2026-10-06 真实写入的字段形状（独立脚本 执行写入() 的 return，见 kdocs-scripts/AirScript-登记写入-独立脚本.md）。
const 成功样例 = {
  scriptVersion: "2026-09-30.16",
  mode: "write",
  sheet: "德达医疗器械发票登记 --毛叶红",
  duplicate: false,
  written: true,
  row: 2777,
  requestedRow: 2777,
  orderNo: "5127686424005021034",
  writtenColumns: ["S"],
  dateColumns: [],
  failedColumns: [],
  readBack: ["A=46286", "F=正常", "G=普票", "J=5127686424005021034", "S=同一个订单发票开一起"],
};

test("成功样例：written=true + 目标列在 writtenColumns → 已写入（不再 undefined）", () => {
  const 判定 = 判定写入(成功样例, "S");
  assert.equal(判定.成功, true);
  assert.equal(判定.状态, "已写入");
  assert.equal(判定.原因, "");
});

test("失败样例（指定行是别人的单号）：written=false → 写入失败并带云端原因", () => {
  const 判定 = 判定写入(
    { ...成功样例, written: false, writtenColumns: [], readBack: [], message: "指定行 J 列是别的订单号（3316…），拒绝覆盖" },
    "S"
  );
  assert.equal(判定.成功, false);
  assert.equal(判定.状态, "写入失败");
  assert.match(判定.原因, /别的订单号/);
});

test("反向断言：只有 mode='write'（缺 written）不算成功——不许退回按 mode 判", () => {
  const 判定 = 判定写入(
    { scriptVersion: "x", mode: "write", sheet: "科技--唐雪梅", message: "缺少 allowWrite:true，未授权写入" },
    "S"
  );
  assert.equal(判定.成功, false);
  assert.match(判定.原因, /allowWrite/);
});

test("反向断言：带 status='已写入' 但没有 written:true 的返回必须判失败（锁死旧 bug 不许回来）", () => {
  const 判定 = 判定写入({ status: "已写入", mode: "write", row: 2777 }, "S");
  assert.equal(判定.成功, false);
});

test("真实实测：单行 readBack 被云端截成「A=46301,,2,18,…」照样判成功，不许拿回读判成败", () => {
  // 2026-10-06 实测 S2777 写入返回（云端 读一行() 对单行二维数组没拆层，只截前 40 字）。
  const 判定 = 判定写入({ ...成功样例, readBack: ["A=46301,,2,18,2,正常,普票,,天猫1店,51276864240050"] }, "S");
  assert.equal(判定.成功, true);
  assert.equal(判定.状态, "已写入");
});

test("written=true 但 failedColumns 非空 → 失败（不许把部分失败当成功）", () => {
  const 判定 = 判定写入({ ...成功样例, failedColumns: ["S"] }, "S");
  assert.equal(判定.成功, false);
  assert.match(判定.原因, /S 列没写进去/);
});

test("written=true 但目标列不在 writtenColumns → 失败（挡云端静默跳过）", () => {
  const 判定 = 判定写入({ ...成功样例, writtenColumns: ["F"] }, "S");
  assert.equal(判定.成功, false);
  assert.match(判定.原因, /没有目标列 S/);
});

test("备注列口径：两表都是 S（T 是公式列，由 main 里的红线挡）", () => {
  assert.equal(备注列("德达医疗器械发票登记 --毛叶红"), "S");
  assert.equal(备注列("科技--唐雪梅"), "S");
});
