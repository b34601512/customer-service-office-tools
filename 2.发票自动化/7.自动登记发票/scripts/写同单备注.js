// 7号 动作：给「同一单多行」写收尾备注（默认 T 列「同一个订单发票开一起」）——一个动作：只写这一格。
// 用法：node scripts/写同单备注.js --订单号 <单号> --表 "<子表名>" --行 <行号> [--脚本 write|write_jituan] [--列 T] [--文本 "同一个订单发票开一起"] --已确认
// 说明：写入逐次授权（--已确认）；只写指定行的那一格，不碰别的列；写完回读。
const { 跑脚本 } = require("../src/金山脚本客户端");

function 解析参数(argv) {
  const 结果 = { 表名: "", 脚本: "write", 列: "", 文本: "同一个订单发票开一起", 行: 0, 订单号: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--订单号") { 结果.订单号 = argv[i + 1]; i += 1; continue; }
    if (词 === "--表") { 结果.表名 = argv[i + 1]; i += 1; continue; }
    if (词 === "--脚本") { 结果.脚本 = argv[i + 1]; i += 1; continue; }
    if (词 === "--列") { 结果.列 = argv[i + 1]; i += 1; continue; }
    if (词 === "--文本") { 结果.文本 = argv[i + 1]; i += 1; continue; }
    if (词 === "--行") { 结果.行 = Number(argv[i + 1]) || 0; i += 1; continue; }
    if (词 === "--已确认") { 结果.已确认 = true; continue; }
  }
  return 结果;
}

// 备注列（用户 2026-09-30）：**两表都是 S**（集团表删掉多余 K 空列后列已一致）。
// 注意：两表的 T 都是「品名规格」公式列，**绝对不能碰**（2026-09-30 踩过两次）。
function 备注列(表名) {
  void 表名;
  return "S";
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (!参数.订单号 || !参数.表名 || !参数.行) {
    console.error('用法：node scripts/写同单备注.js --订单号 <单号> --表 "<子表名>" --行 <行号> [--脚本 write|write_jituan] [--列 T] [--文本 "…"] --已确认');
    process.exit(2);
  }
  // 公式列红线：两表的 T 列都是「品名规格」公式列，任何写入都不许碰（2026-09-30 踩过两次）。
  if ((参数.列 || 备注列(参数.表名)) === "T") { console.error("拒绝：T 列是「品名规格」公式列（两表都一样），不能碰；备注列是 S。"); process.exit(2); }
  if (!参数.已确认) { console.error("未授权：写表必须逐次授权，请加 --已确认"); process.exit(2); }
  const 列 = 参数.列 || 备注列(参数.表名);
  const 结果 = await 跑脚本(
    {
      orderNo: 参数.订单号,
      row: 参数.行,
      writeCells: { [列]: 参数.文本 },
      allowWrite: true,
      sheets: [参数.表名]
    },
    { 脚本: 参数.脚本 }
  );
  console.log(`\n  写同单备注：状态=${结果 && 结果.status}`);
  console.log(`  订单号 ${参数.订单号}　表 ${参数.表名}　行 ${参数.行}　${列}=${参数.文本}`);
  if (结果 && 结果.readBack) console.log(`  写后回读：${JSON.stringify(结果.readBack).slice(0, 200)}`);
  if (!结果 || 结果.status !== "已写入") process.exitCode = 1;
}

main().catch((错误) => { console.log("失败：" + (错误 && 错误.message ? 错误.message : 错误)); process.exitCode = 1; });
