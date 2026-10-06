// 7号 动作②：**干跑** —— 算出这单要写的列（含目标表列映射），一个字节都不写。
// 用法：node scripts/干跑.js --订单号 5127724117341157631 --表 "科技--唐雪梅"
//   --明细序号 <n>：0=主商品（默认）；1/2…=赠品行（与 scripts/写登记表.js 同口径，证据文件带 -明细序号）。
const path = require("path");
const fs = require("fs");
const { 生成写表数据 } = require("../src/发票规则");
const { 读清单条目, 默认表名 } = require("../src/登记写入");

const 项目根 = path.resolve(__dirname, "..");
const 清单路径 = path.join(项目根, "project-config", "待登记清单.jsonl");
const 证据目录 = path.join(项目根, "runtime");

async function main() {
  const argv = process.argv.slice(2);
  let 表名 = 默认表名;
  let 订单号 = "";
  let 明细序号 = 0;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--表") { 表名 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--订单号") { 订单号 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--明细序号") { 明细序号 = Number(argv[i + 1]) || 0; i += 1; continue; }
  }
  if (!订单号) { console.error("用法：node scripts/干跑.js --订单号 <单号> [--表 <子表名>] [--明细序号 <n>]"); process.exit(2); }

  const 条目 = 读清单条目(清单路径, 订单号);
  const 数据 = 生成写表数据(条目, { 表名, 明细序号 });
  const 待人工 = 数据.待人工 || [];
  console.log(`\n  ② 干跑（不写）：订单号 ${订单号}　表 ${表名}${明细序号 ? `　明细序号：${明细序号}（赠品行）` : ""}`);
  console.log(`  待人工项：${待人工.length ? 待人工.join("；") : "无 ✓"}`);
  console.log("  将要写入的列（只写这些，公式列不碰）：");
  for (const [字母, 项] of Object.entries(数据.列 || {})) {
    console.log(`    ${字母}=${项.值}   (${项.类型}${项.说明 ? " / " + 项.说明 : ""})`);
  }
  try {
    fs.mkdirSync(证据目录, { recursive: true });
    const 文件 = path.join(证据目录, `干跑-${订单号}${明细序号 ? `-明细${明细序号}` : ""}.json`);
    fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), 订单号, 表名, 明细序号, 列: 数据.列, 待人工 }, null, 2), "utf8");
    console.log(`  证据：${path.relative(项目根, 文件)}`);
  } catch (_错误) { /* 证据可选 */ }
  console.log("");
  if (待人工.length) process.exitCode = 4;
}

main().catch((错误) => { console.error(`\n  干跑失败：${错误.message}\n`); process.exit(1); });
