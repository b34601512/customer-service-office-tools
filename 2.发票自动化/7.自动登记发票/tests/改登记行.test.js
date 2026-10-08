// 7号：改登记行.js 的闸门单测（离线，不触网、不碰真表）。
// 锁死四道闸：① 身份（J=本单，表尾新行必须 --改 写 J + 探针位置对上）② 列白名单（公式列一律拒）
// ③ 数字类型（V/Y/A/AK 转数字）④ 云端返回判据（只认 written===true + 每个目标列都在 writtenColumns）。
// 反向断言：带 status:'已写入' 但没有 written:true 的返回必须判失败（别退回按 status/mode 判）。
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  解析参数, 检查参数, 解析改列, 检查列, 转类型, 推导查脚本,
  取行值, 判定身份, 检查新行位置, 判定写入, 生成请求,
  列白名单, 公式列, 数字列,
} = require("../scripts/改登记行");

const 本单 = "260926-***********0863";
const 表名 = "德达医疗器械发票登记 --毛叶红";

// 云端按行读的真实返回形状（runtime/查表-拆行前-2773-2788.json 摘录）。
const 样例云端 = {
  dump: [
    {
      row: 2781,
      sheet: 表名,
      values: [
        "A=46303",
        "C=1 ⟵ =COUNTIFS('德达医疗器械发票登记 --毛叶红'!J:J,'德达医疗器械发票登记 --毛叶红'!J2781)",
        "F=正常",
        "G=普票",
        "I=拼多多02店",
        "J=260926-***********0863",
        "O=木婉清",
        "T=纯正弦波逆变器 ⟵ =BR2781&BT2781",
        "U=纯正弦波逆变器",
        "V=1",
        "X=697.96 ⟵ =Y2781/V2781",
        "Y=697.96",
        "AA=青岛元胜堂医疗管理有限公司",
        "AB=91370203MAE2TXW57X",
        "AK=46291",
      ],
    },
    {
      row: 2788,
      sheet: 表名,
      values: ["F=正常", "G=普票", "T=铜螺母 ⟵ =BR2788&BT2788", "W=个 ⟵ =BU2788"],
    },
  ],
};

// 云端写入脚本（独立脚本 v2026-09-30.16+）成功返回的真实字段形状。
const 写入成功样例 = {
  scriptVersion: "2026-10-06.17",
  mode: "write",
  sheet: 表名,
  written: true,
  row: 2788,
  requestedRow: 2788,
  orderNo: 本单,
  writtenColumns: ["A", "F", "G", "I", "J", "O", "U", "V", "Y", "AA", "AB", "AK"],
  failedColumns: [],
  readBack: ["A=46303", "J=260926-***********0863", "U=300W", "Y=104.7"],
};

test("参数解析：齐全的命令解析成结构化参数（--行 是数字、默认写脚本 write）", () => {
  const 参数 = 解析参数([
    "--订单号", 本单, "--表", 表名, "--行", "2781",
    "--改", "U=DH22-C1L,Y=593.30", "--已确认",
  ]);
  assert.equal(参数.订单号, 本单);
  assert.equal(参数.表名, 表名);
  assert.equal(参数.行, 2781);
  assert.equal(参数.改, "U=DH22-C1L,Y=593.30");
  assert.equal(参数.脚本, "write");
  assert.equal(参数.查脚本, "");
  assert.equal(参数.已确认, true);
});

test("参数解析：支持 --脚本/--查脚本 覆盖；--已确认 缺省为 false", () => {
  const 参数 = 解析参数(["--订单号", 本单, "--表", 表名, "--行", "10497", "--改", "U=X", "--脚本", "write_jituan", "--查脚本", "query_jituan"]);
  assert.equal(参数.脚本, "write_jituan");
  assert.equal(参数.查脚本, "query_jituan");
  assert.equal(参数.已确认, false);
});

test("检查参数：缺 --已确认 → 拒（写表必须逐次授权）", () => {
  const 参数 = 解析参数(["--订单号", 本单, "--表", 表名, "--行", "2781", "--改", "U=DH22-C1L"]);
  const 检查 = 检查参数(参数);
  assert.equal(检查.通过, undefined);
  assert.match(检查.错误, /--已确认/);
});

test("检查参数：缺 --行/--改/--表/--订单号 都拒", () => {
  const 齐全 = { 订单号: 本单, 表名, 行: 2781, 改: "U=X", 已确认: true };
  assert.equal(检查参数({ ...齐全, 行: 0 }).通过, undefined);
  assert.equal(检查参数({ ...齐全, 改: "" }).通过, undefined);
  assert.equal(检查参数({ ...齐全, 表名: "" }).通过, undefined);
  assert.equal(检查参数({ ...齐全, 订单号: "" }).通过, undefined);
  assert.equal(检查参数(齐全).通过, true);
});

test("解析 --改：多列 + 中文逗号 + 列名统一大写", () => {
  const 解析 = 解析改列(" u=DH22-C1L，y=593.30 ");
  assert.deepEqual(解析.列, { U: "DH22-C1L", Y: "593.30" });
});

test("解析 --改：没等号 / 值为空 / 重复列 → 都拒", () => {
  assert.match(解析改列("U").错误, /解析不了/);
  assert.match(解析改列("U=").错误, /解析不了/);
  assert.match(解析改列("U=1,U=2").错误, /写了两次/);
  assert.match(解析改列("").错误, /空的/);
});

test("取行值：剥掉公式标记、解析出 J/U/Y（含中文值）", () => {
  const 值 = 取行值(样例云端, 2781);
  assert.equal(值.J, 本单);
  assert.equal(值.U, "纯正弦波逆变器");
  assert.equal(值.Y, "697.96");
  assert.equal(值.T, "纯正弦波逆变器"); // 公式标记「 ⟵ 」后的内容不留在值里
  assert.equal(值.AA, "青岛元胜堂医疗管理有限公司");
  assert.equal(取行值(样例云端, 9999), null);
});

test("闸门① 身份：J=本单 → 放行", () => {
  const 判定 = 判定身份(样例云端, 2781, 本单, { U: "DH22-C1L", Y: 593.3 });
  assert.equal(判定.通过, true);
  assert.equal(判定.当前J, 本单);
});

test("闸门① 身份：J 是别人的订单号 → 拒（不许覆盖）", () => {
  const 判定 = 判定身份(样例云端, 2781, "260930-***********1322", { U: "DH22-C1L" });
  assert.equal(判定.通过, false);
  assert.match(判定.原因, /拒绝覆盖/);
  assert.match(判定.原因, /260930-***********1322/);
});

test("闸门① 身份：J 空 + --改 写了 J=本单 → 放行（表尾新行，身份由本次写入建立）", () => {
  const 判定 = 判定身份(样例云端, 2788, 本单, { J: 本单, U: "300W" });
  assert.equal(判定.通过, true);
  assert.equal(判定.当前J, "");
  assert.match(判定.说明, /J 为空/);
});

test("闸门① 身份：J 空但 --改 没写 J → 拒（无法确认是本单）", () => {
  const 判定 = 判定身份(样例云端, 2788, 本单, { U: "300W" });
  assert.equal(判定.通过, false);
  assert.match(判定.原因, /J 为空/);
});

test("闸门① 身份：读不到该行 → 拒（宁可停手，也不瞎写）", () => {
  const 判定 = 判定身份({ dump: [] }, 2788, 本单, { J: 本单 });
  assert.equal(判定.通过, false);
  assert.match(判定.原因, /读不到第 2788 行/);
});

test("闸门① 表尾位置：探针 nextWriteRow=2788 → 放行；=2790 → 拒；没有 → 拒", () => {
  assert.equal(检查新行位置({ nextWriteRow: 2788 }, 2788).通过, true);
  assert.match(检查新行位置({ nextWriteRow: 2790 }, 2788).原因, /不是 --行 2788/);
  assert.match(检查新行位置({}, 2788).原因, /没有回 nextWriteRow/);
});

test("闸门② 列白名单：13 个数据列全放行", () => {
  const 列 = {};
  for (const 字母 of 列白名单) 列[字母] = "x";
  assert.equal(检查列(列).通过, true);
});

test("闸门② 公式列 C/D/E/M/T/W/X/AO 一律拒（写进去公式就没了）", () => {
  for (const 列 of 公式列) {
    const 判定 = 检查列({ [列]: "x" });
    assert.equal(判定.通过, false, `${列} 应被拒`);
    assert.match(判定.原因, /公式列/);
  }
});

test("闸门② 白名单外的列（S 备注走写同单备注.js；P/Q/R 等）→ 拒", () => {
  assert.match(检查列({ S: "同一个订单发票开一起" }).原因, /不在白名单/);
  assert.match(检查列({ P: "木婉清" }).原因, /不在白名单/);
  assert.match(检查列({}).原因, /没有任何列/);
});

test("闸门③ 类型：V/Y/A/AK 转数字；U/J/AB 保持字符串", () => {
  const 解析 = 解析改列("U=DH22-C1L,Y=593.30,V=1,AK=46291,A=46303,J=" + 本单 + ",AB=91370203MAE2TXW57X");
  const 类型 = 转类型(解析.列);
  assert.equal(类型.错误, undefined);
  assert.equal(typeof 类型.列.Y, "number");
  assert.equal(类型.列.Y, 593.3);
  assert.equal(typeof 类型.列.V, "number");
  assert.equal(类型.列.V, 1);
  assert.equal(typeof 类型.列.AK, "number");
  assert.equal(类型.列.AK, 46291);
  assert.equal(typeof 类型.列.A, "number");
  assert.equal(类型.列.A, 46303);
  assert.equal(typeof 类型.列.U, "string");
  assert.equal(typeof 类型.列.J, "string");
  assert.equal(typeof 类型.列.AB, "string");
  assert.deepEqual(数字列, ["A", "V", "Y", "AK"]);
});

test("闸门③ 类型：金额列给了非数字（Y=abc）→ 拒", () => {
  const 类型 = 转类型({ Y: "abc" });
  assert.match(类型.错误, /Y 列要求数字/);
  assert.match(转类型({ AK: "昨天" }).错误, /AK 列要求数字/);
});

test("闸门④ 判据：written=true + 12 列全在 writtenColumns + failedColumns 空 → 已写入", () => {
  const 判定 = 判定写入(写入成功样例, 写入成功样例.writtenColumns);
  assert.equal(判定.成功, true);
  assert.equal(判定.状态, "已写入");
  assert.equal(判定.原因, "");
});

test("闸门④ 反向断言：带 status='已写入' 但没有 written:true 的返回必须判失败（旧 bug 不许回来）", () => {
  const 判定 = 判定写入({ status: "已写入", mode: "write", row: 2788 }, ["U"]);
  assert.equal(判定.成功, false);
  assert.match(判定.原因, /written:true/);
});

test("闸门④：written=false + message → 失败并带云端原因", () => {
  const 判定 = 判定写入({ ...写入成功样例, written: false, message: "指定行 J 列是别的订单号（3316…），拒绝覆盖", writtenColumns: [] }, ["U"]);
  assert.equal(判定.成功, false);
  assert.match(判定.原因, /别的订单号/);
});

test("闸门④：written=true 但 failedColumns 非空 → 失败（不许把部分失败当成功）", () => {
  const 判定 = 判定写入({ ...写入成功样例, failedColumns: ["Y"] }, ["U", "Y"]);
  assert.equal(判定.成功, false);
  assert.match(判定.原因, /Y 列没写进去/);
});

test("闸门④：written=true 但目标列缺一个（Y 不在 writtenColumns）→ 失败（挡云端静默跳过）", () => {
  const 判定 = 判定写入({ ...写入成功样例, writtenColumns: ["A", "U"] }, ["A", "U", "Y"]);
  assert.equal(判定.成功, false);
  assert.match(判定.原因, /缺目标列 Y/);
});

test("生成请求：row 是数字、allowWrite=true、sheets=[表名]", () => {
  const 请求 = 生成请求(本单, 表名, "2788", { J: 本单, U: "300W" });
  assert.deepEqual(请求, { orderNo: 本单, row: 2788, writeCells: { J: 本单, U: "300W" }, allowWrite: true, sheets: [表名] });
});

test("推导查脚本：write→query、write_jituan→query_jituan、不认识→空（必须显式 --查脚本）", () => {
  assert.equal(推导查脚本("write"), "query");
  assert.equal(推导查脚本("write_jituan"), "query_jituan");
  assert.equal(推导查脚本("write_other"), "");
});
