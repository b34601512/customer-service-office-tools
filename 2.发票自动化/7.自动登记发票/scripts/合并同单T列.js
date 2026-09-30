// 7号 动作：同一单多行 → **只合并 T 列**（用户 2026-09-30 口径）。一个动作：只合并，不写任何内容。
// 用法：node scripts/合并同单T列.js --订单号 <单号> --表 "<子表名>" [--脚本 合并|合并_毛叶红] [--列 T] --已确认
// 说明：调用云端「登记表-合并」脚本（mergeCols 显式传 T）；云端自带安全闸（≥2 行、行连续、每行 J=本单、≤50 行）。
const { 跑脚本 } = require("../src/金山脚本客户端");

function 解析参数(argv) {
  const 结果 = { 表名: "", 脚本: "", 列: "", 订单号: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--订单号") { 结果.订单号 = argv[i + 1]; i += 1; continue; }
    if (词 === "--表") { 结果.表名 = argv[i + 1]; i += 1; continue; }
    if (词 === "--脚本") { 结果.脚本 = argv[i + 1]; i += 1; continue; }
    if (词 === "--列") { 结果.列 = argv[i + 1]; i += 1; continue; }
    if (词 === "--已确认") { 结果.已确认 = true; continue; }
  }
  return 结果;
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (!参数.订单号 || !参数.表名) {
    console.error('用法：node scripts/合并同单T列.js --订单号 <单号> --表 "<子表名>" [--脚本 合并|合并_毛叶红] [--列 T] --已确认');
    process.exit(2);
  }
  // 公式列红线：两表的 T 列都是「品名规格」公式列，不许合并/写入（2026-09-30 踩过两次）。
  if ((参数.列 || "S") === "T") { console.error("拒绝：T 列是「品名规格」公式列（两表都一样），不能碰；备注列是 S。"); process.exit(2); }
  if (!参数.已确认) { console.error("未授权：合并会改表格格式，必须逐次授权，请加 --已确认"); process.exit(2); }
  const 脚本 = 参数.脚本 || (/毛叶红|德达/.test(参数.表名) ? "合并_毛叶红" : "合并");
  // 备注列（用户 2026-09-30）：**两表都是 S**（集团表删掉多余 K 空列后列已一致）。
  const 列 = 参数.列 || "S";
  const 结果 = await 跑脚本(
    { orderNo: 参数.订单号, mergeCols: [列], allowWrite: true, sheets: [参数.表名] },
    { 脚本 }
  );
  console.log(`\n  合并同单：脚本=${脚本} 表=${参数.表名} 订单号=${参数.订单号} 列=${列}`);
  console.log(`  返回：${JSON.stringify(结果).slice(0, 400)}`);
  const 成功 = 结果 && (结果.mergedCells > 0 || 结果.mode === "merge");
  if (!成功) process.exitCode = 1;
}

main().catch((错误) => { console.log("失败：" + (错误 && 错误.message ? 错误.message : 错误)); process.exitCode = 1; });
