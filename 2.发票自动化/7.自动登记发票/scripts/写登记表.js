// 7号 动作⑤：**写登记表**（唯一会真写的动作）—— 只写一行、只写指定列，四道闸门按序不可改。
//   闸门1 字段不全拒写 → 闸门2 未授权不写（连查重都不跑）→ 闸门3 云端查重命中拒写 → 闸门4 写完回读必须恰好 1 行。
// 用法：node scripts/写登记表.js --订单号 <单号> --表 "科技--唐雪梅" --脚本 write_jituan --已确认
const path = require("path");
const fs = require("fs");
const { 跑脚本 } = require("../src/金山脚本客户端");
const { 生成写表数据 } = require("../src/发票规则");
const { 写登记行, 默认表名, 读清单条目 } = require("../src/登记写入");

const 项目根 = path.resolve(__dirname, "..");
const 清单路径 = path.join(项目根, "project-config", "待登记清单.jsonl");
const 证据目录 = path.join(项目根, "runtime");

function 解析参数(argv) {
  const 结果 = { 已确认: false };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--订单号") { 结果.订单号 = argv[i + 1]; i += 1; continue; }
    if (词 === "--表") { 结果.表名 = argv[i + 1]; i += 1; continue; }
    if (词 === "--脚本") { 结果.脚本 = argv[i + 1]; i += 1; continue; }
    if (词 === "--已确认") { 结果.已确认 = true; continue; }
  }
  return 结果;
}

function 落证据(结果) {
  try {
    fs.mkdirSync(证据目录, { recursive: true });
    const 文件 = path.join(证据目录, `写入-${String(结果.订单号 || "未知").replace(/[^\w-]/g, "_")}.json`);
    fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), ...结果 }, null, 2), "utf8");
    return 文件;
  } catch (_错误) { return ""; }
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (!参数.订单号) { console.error('用法：node scripts/写登记表.js --订单号 <单号> [--表 <子表名>] [--脚本 write_jituan] --已确认'); process.exit(2); }
  const 表名 = 参数.表名 || 默认表名;
  const 条目 = 读清单条目(清单路径, 参数.订单号);
  const 结果 = await 写登记行(条目, { 跑脚本: (a) => 跑脚本(a, { 脚本: 参数.脚本 || "write" }), 生成写表数据 }, {
    已确认: 参数.已确认 === true,
    表名,
  });
  const 证据文件 = 落证据(结果);
  console.log(`\n  ⑤ 写登记表：状态=${结果.状态}`);
  console.log(`  订单号：${结果.订单号}　表：${结果.表名}`);
  if (结果.行号) console.log(`  行号：第 ${结果.行号} 行`);
  if (结果.命中行) console.log(`  云端已有：第 ${结果.命中行} 行`);
  if (结果.原因) console.log(`  原因：${结果.原因}`);
  if (结果.说明) console.log(`  说明：${结果.说明}`);
  if (结果.列) {
    console.log("  将要写入的列：");
    for (const [字母, 值] of Object.entries(结果.列)) console.log(`    ${字母}=${值}`);
    for (const [字母, 值] of Object.entries(结果.日期列 || {})) console.log(`    ${字母}=${值}（日期格式）`);
  }
  if (结果.写入列 && 结果.写入列.length) console.log(`  已写入：${结果.写入列.join("、")}${(结果.日期列 || []).length ? " + 日期列 " + 结果.日期列.join("、") : ""}`);
  if (结果.回读 && 结果.回读.length) console.log(`  写后回读：${结果.回读.join(" | ").slice(0, 300)}`);
  if (证据文件) console.log(`  证据：${path.relative(项目根, 证据文件)}`);
  console.log("");
  if (结果.状态 === "等授权") process.exitCode = 2;
  else if (结果.状态 === "已登记") process.exitCode = 3;
  else if (结果.状态 !== "已写入") process.exitCode = 4;
}

main().catch((错误) => { console.error(`\n  写入失败：${错误.message}\n`); process.exit(1); });
