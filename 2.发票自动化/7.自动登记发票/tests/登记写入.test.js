// 7号：登记写入闸门单测（离线，不触网、不碰真表）。
// 这些断言就是「重复登记=重复交税」的防线：顺序不能变、少一道都不行。
const test = require("node:test");
const assert = require("node:assert/strict");
const { 写登记行 } = require("../src/登记写入");

const 齐全条目 = {
  订单号: "260903-171347832413939",
  店铺: "拼多多02店",
  发票类型: "普票",
  开票金额: 374.12,
  抬头: "某某艺术中心",
  税号: "91411702XXXXXXXXXX",
  登记时间: "2026-09-30 09:00:00",
  商品明细: [{ 型号: "DH22-C1", 订购数: "1", 规格名称: "DH22-C1(9L)" }],
};

function 造依赖({ 查重结果 = { matchCount: 0 }, 写入结果, 回读结果 } = {}) {
  const 调用记录 = [];
  const 跑脚本 = async (argv) => {
    调用记录.push(argv);
    if (argv.orderNo) return 写入结果 || { written: true, row: 7911, writtenColumns: ["A", "J"], readBack: ["A=46295", "J=260903-…"] };
    if (argv.keywords && 调用记录.filter((x) => x.keywords).length > 1) return 回读结果 || { matchCount: 1, matches: [{ row: 7911 }] };
    return 查重结果;
  };
  const 生成写表数据 = () => ({
    列: { A: { 值: 46295 }, F: { 值: "正常" }, J: { 值: "260903-171347832413939" } },
    待人工: [],
  });
  return { 依赖: { 跑脚本, 生成写表数据 }, 调用记录 };
}

test("没授权时一个字都不写，只回报要写的列", async () => {
  const { 依赖, 调用记录 } = 造依赖();
  const 结果 = await 写登记行(齐全条目, 依赖, { 已确认: false });
  assert.equal(结果.状态, "等授权");
  assert.equal(调用记录.length, 0, "未授权时不允许任何云端调用（连查重都不跑）");
  assert.equal(结果.列.J, "260903-171347832413939");
});

test("字段不全时拒写，不去云端也不写表", async () => {
  const 依赖 = {
    跑脚本: async () => { throw new Error("不该被调用"); },
    生成写表数据: () => ({ 列: { J: { 值: "x" } }, 待人工: ["开票金额取不到（Y 列）"] }),
  };
  const 结果 = await 写登记行(齐全条目, 依赖, { 已确认: true });
  assert.equal(结果.状态, "拒写");
  assert.match(结果.原因, /开票金额取不到/);
});

test("云端已有该订单号时拒写（重复登记=重复交税）", async () => {
  const { 依赖, 调用记录 } = 造依赖({ 查重结果: { matchCount: 1, matches: [{ row: 2751 }] } });
  const 结果 = await 写登记行(齐全条目, 依赖, { 已确认: true });
  assert.equal(结果.状态, "已登记");
  assert.equal(结果.命中行, 2751);
  assert.equal(调用记录.filter((x) => x.orderNo).length, 0, "查重命中后绝不允许调用写入");
});

test("写入成功后回读必须恰好 1 行且行号一致", async () => {
  const { 依赖, 调用记录 } = 造依赖();
  const 结果 = await 写登记行(齐全条目, 依赖, { 已确认: true });
  assert.equal(结果.状态, "已写入");
  assert.equal(结果.行号, 7911);
  assert.deepEqual(调用记录.map((x) => (x.orderNo ? "写" : "查")), ["查", "写", "查"]);
});

test("回读出现 2 行时立刻报错（可能重复登记，必须人工核对）", async () => {
  const { 依赖 } = 造依赖({ 回读结果: { matchCount: 2, matches: [{ row: 7911 }, { row: 7912 }] } });
  await assert.rejects(() => 写登记行(齐全条目, 依赖, { 已确认: true }), /回读到 2 行/);
});

test("回读行号与写入行号不一致时报错，不当作成功", async () => {
  const { 依赖 } = 造依赖({ 回读结果: { matchCount: 1, matches: [{ row: 7000 }] } });
  await assert.rejects(() => 写登记行(齐全条目, 依赖, { 已确认: true }), /行号 7000（期望 7911）/);
});

test("部分列写入失败时抛错并点名列，不静默", async () => {
  const { 依赖 } = 造依赖({ 写入结果: { written: true, row: 7911, writtenColumns: ["A"], failedColumns: ["J", "Y"], readBack: [] } });
  await assert.rejects(() => 写登记行(齐全条目, 依赖, { 已确认: true }), /部分列失败：J、Y/);
});

test("云端返回 written:false 时按失败处理，不误报成功", async () => {
  const { 依赖 } = 造依赖({ 写入结果: { written: false, message: "缺少 allowWrite:true，未授权写入" } });
  const 结果 = await 写登记行(齐全条目, 依赖, { 已确认: true });
  assert.equal(结果.状态, "写入失败");
});
