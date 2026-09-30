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

function 造依赖({ 查重结果 = { duplicate: false, row: 0 }, 写入结果, 回读结果 } = {}) {
  const 调用记录 = [];
  let 查重次数 = 0;
  const 跑脚本 = async (argv) => {
    调用记录.push(argv);
    if (argv.checkOnly) {
      查重次数 += 1;
      if (查重次数 > 1) return 回读结果 || { duplicate: true, row: 7911 };
      return 查重结果;
    }
    if (argv.orderNo) return 写入结果 || { written: true, row: 7911, writtenColumns: ["A", "J"], readBack: ["A=46295", "J=260903-…"] };
    return {};
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
  const { 依赖, 调用记录 } = 造依赖({ 查重结果: { duplicate: true, row: 2751 } });
  const 结果 = await 写登记行(齐全条目, 依赖, { 已确认: true });
  assert.equal(结果.状态, "已登记");
  assert.equal(结果.命中行, 2751);
  assert.equal(调用记录.filter((x) => x.writeCells).length, 0, "查重命中后绝不允许调用写入");
});

test("写入成功后回读必须命中同一行", async () => {
  const { 依赖, 调用记录 } = 造依赖();
  const 结果 = await 写登记行(齐全条目, 依赖, { 已确认: true });
  assert.equal(结果.状态, "已写入");
  assert.equal(结果.行号, 7911);
  assert.deepEqual(调用记录.map((x) => (x.writeCells ? "写" : "查")), ["查", "写", "查"]);
});

test("回读查不到时报错（可能没写进去，必须人工核对）", async () => {
  const { 依赖 } = 造依赖({ 回读结果: { duplicate: false, row: 0 } });
  await assert.rejects(() => 写登记行(齐全条目, 依赖, { 已确认: true }), /写后回读异常/);
});

test("回读行号与写入行号不一致时报错，不当作成功", async () => {
  const { 依赖 } = 造依赖({ 回读结果: { duplicate: true, row: 7000 } });
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

// 两张登记表的列位置不同（2026-09-30 实测）：表②（集团）从 O 列起整体右移一列。
// 反向断言：谁把「表②也按①的列写」改回来，这里就会红。
const { 表列偏移, 映射列字母, 生成写表数据 } = require("../src/发票规则");

test("表列偏移：表①不动，表②（科技/集团）整体 +1", () => {
  assert.strictEqual(表列偏移("德达医疗器械发票登记 --毛叶红"), 0);
  assert.strictEqual(表列偏移("科技--唐雪梅"), 1);
  assert.strictEqual(映射列字母("O", "科技--唐雪梅"), "P");
  assert.strictEqual(映射列字母("U", "科技--唐雪梅"), "V");
  assert.strictEqual(映射列字母("V", "科技--唐雪梅"), "W");
  assert.strictEqual(映射列字母("Y", "科技--唐雪梅"), "Z");
  assert.strictEqual(映射列字母("AA", "科技--唐雪梅"), "AB");
  assert.strictEqual(映射列字母("AB", "科技--唐雪梅"), "AC");
  assert.strictEqual(映射列字母("AK", "科技--唐雪梅"), "AL");
  assert.strictEqual(映射列字母("J", "科技--唐雪梅"), "J");
  assert.strictEqual(映射列字母("O", "德达医疗器械发票登记 --毛叶红"), "O");
});

test("生成写表数据：表②要写成 P/V/W/Z/AB/AC/AL，且绝不出现①的 O/U/Y/AA/AK", () => {
  const 条目 = {
    订单号: "5127724117341157631", 店铺: "天猫6店", 发票类型: "增值税电子普通发票",
    开票金额: 499, 抬头: "天虹数科商业股份有限公司", 税号: "91440300618842912J",
    登记时间: "2026-09-30 10:00:00", 发货日期: "2026-09-06",
    商品明细: [{ 规格名称: "家用制氧机DH21-A1L（LV）DEDAKJ", 型号: "DH21-A1L", 订购数: "1", 买家支付金额: "499.0" }],
  };
  const 列 = Object.keys(生成写表数据(条目, { 表名: "科技--唐雪梅" }).列).sort().join(",");
  assert.strictEqual(列, "A,AB,AC,AL,F,G,I,J,P,V,W,Z");
});

// 赠品行（订单里的附带赠品）：2026-09-30 用户要求「一并登记，金额 0 元」。
// 口径：明细序号 0 = 主商品；1/2… = 商品明细里的第 n 条（赠品）→ 金额取该行买家支付金额（通常 0），
// 且**同订单号是预期的**（不放云端查重），但字段/授权/回读闸门照走。
test("赠品行：明细序号 1/2 取对应明细、金额为 0；序号 0 仍取开票金额", () => {
  const 条目 = {
    订单号: "5127724117341157631", 店铺: "天猫6店", 发票类型: "增值税电子普通发票",
    开票金额: 499, 抬头: "天虹数科商业股份有限公司", 税号: "91440300618842912J",
    登记时间: "2026-09-30 10:00:00", 发货日期: "2026-09-06",
    商品明细: [
      { 规格名称: "家用制氧机DH21-A1L（LV）DEDAKJ", 型号: "DH21-A1L", 订购数: "1", 买家支付金额: "499.0", 赠品: false },
      { 规格名称: "氧气袋(DEDAKJ）", 型号: "YQD-DK", 订购数: "1", 买家支付金额: "0", 赠品: true },
      { 规格名称: "鼻氧管-德达（2米*透明）", 型号: "BYG-DD-2m", 订购数: "2", 买家支付金额: "0", 赠品: true },
    ],
  };
  const 主 = 生成写表数据(条目, { 表名: "科技--唐雪梅" }).列;
  assert.strictEqual(主.V.值, "DH21-A1L");
  assert.strictEqual(主.W.值, 1);
  assert.strictEqual(Number(主.Z.值), 499);

  const 赠1 = 生成写表数据(条目, { 表名: "科技--唐雪梅", 明细序号: 1 }).列;
  assert.strictEqual(赠1.V.值, "YQD-DK");
  assert.strictEqual(赠1.W.值, 1);
  assert.strictEqual(赠1.Z, undefined);  // 赠品金额按表里习惯留空
  assert.strictEqual(赠1.J.值, "5127724117341157631");

  const 赠2 = 生成写表数据(条目, { 表名: "科技--唐雪梅", 明细序号: 2 }).列;
  assert.strictEqual(赠2.V.值, "BYG-DD-2m");
  assert.strictEqual(赠2.W.值, 2);
  assert.strictEqual(赠2.Z, undefined);

  // 越界 → 必须报「待人工」，绝不静默拿主商品顶替
  const 越界 = 生成写表数据(条目, { 表名: "科技--唐雪梅", 明细序号: 3 });
  assert.ok(越界.待人工.length > 0);
});

test("赠品行不放查重、但其它闸门照走（明细序号>0 时跳过 checkOnly）", async () => {
  const { 写登记行 } = require("../src/登记写入");
  const 调用 = [];
  const 跑脚本 = async (参数) => {
    调用.push(参数);
    if (参数.checkOnly) return { duplicate: true, row: 10497 };        // 主商品：云端已有 → 必须拒写
    if (参数.probe) return { scriptVersion: "test", lastDataRow: 调用.some((a) => a.allowWrite) ? 10498 : 10497, nextWriteRow: 调用.some((a) => a.allowWrite) ? 10499 : 10498 };
    return { written: true, row: 10498, writtenColumns: ["V", "W", "Z"], dateColumns: ["A", "AL"], readBack: ["J=5127724117341157631", "V=YQD-DK"] };
  };
  const 依赖 = { 跑脚本, 生成写表数据 };
  const 条目 = {
    订单号: "5127724117341157631", 店铺: "天猫6店", 发票类型: "增值税电子普通发票",
    开票金额: 499, 抬头: "天虹数科商业股份有限公司", 税号: "91440300618842912J",
    登记时间: "2026-09-30 10:00:00", 发货日期: "2026-09-06",
    商品明细: [
      { 规格名称: "家用制氧机DH21-A1L（LV）DEDAKJ", 型号: "DH21-A1L", 订购数: "1", 买家支付金额: "499.0", 赠品: false },
      { 规格名称: "氧气袋(DEDAKJ）", 型号: "YQD-DK", 订购数: "1", 买家支付金额: "0", 赠品: true },
    ],
  };
  const 主结果 = await 写登记行(条目, 依赖, { 表名: "科技--唐雪梅", 已确认: true });
  assert.strictEqual(主结果.状态, "已登记");

  调用.length = 0;
  const 赠结果 = await 写登记行(条目, 依赖, { 表名: "科技--唐雪梅", 已确认: true, 明细序号: 1 });
  assert.strictEqual(赠结果.状态, "已写入");
  assert.strictEqual(赠结果.行号, 10498);
  assert.ok(!调用.some((a) => a.checkOnly), "赠品行不该跑云端查重（同订单号是预期的）");
  assert.ok(调用.some((a) => a.allowWrite === true && a.writeCells && a.writeCells.V === "YQD-DK"), "赠品行要写型号");
});
