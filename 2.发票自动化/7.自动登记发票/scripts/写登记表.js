#!/usr/bin/env node
// 7号：把待登记清单里的一条**写进金山发票登记总表**（唯一会真写的脚本；默认不写，只给你看要写什么）。
//
// 安全闸门见 `src/登记写入.js`：字段不全拒写 → 没授权不写 → 云端查重命中拒写 → 写完回读必须 1 行。
//
// 用法：
//   node scripts/写登记表.js --探针                       # 只测云端写入脚本是否已保存生效（不写）
//   node scripts/写登记表.js --订单号 <订单号>                # 只出「将要写入的列」，不写表
//   node scripts/写登记表.js --订单号 <订单号> --已确认        # 用户当场点头后才带这个参数（逐次授权）
//   node scripts/写登记表.js --订单号 <订单号> --已确认 --表 "德达医疗器械发票登记 --毛叶红"
//   node scripts/写登记表.js --dry-run --订单号 <订单号>       # 同上，显式干跑
// 退出码：0 成功 / 2 等授权（没写）/ 3 云端已有该订单号（拒写）/ 4 失败
const fs = require("fs");
const path = require("path");
const { 跑脚本 } = require("../src/金山脚本客户端");
const { 生成写表数据 } = require("../src/发票规则");
const { 写登记行, 探针, 默认表名 } = require("../src/登记写入");

const 项目根 = path.resolve(__dirname, "..");
const 清单路径 = path.join(项目根, "project-config", "待登记清单.jsonl");
const 证据目录 = path.join(项目根, "runtime");

function 解析参数(argv) {
  const 结果 = { 已确认: false };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--订单号") { 结果.订单号 = argv[i + 1]; i += 1; continue; }
    if (词 === "--表") { 结果.表名 = argv[i + 1]; i += 1; continue; }
    if (词 === "--已确认") { 结果.已确认 = true; continue; }
    if (词 === "--dry-run") { 结果.干跑 = true; continue; }
    if (词 === "--探针") { 结果.探针 = true; continue; }
  }
  if (!结果.订单号 && !结果.探针) throw new Error("缺少 --订单号（或 --探针）");
  if (结果.干跑) 结果.已确认 = false;
  return 结果;
}

function 读清单条目(订单号) {
  if (!fs.existsSync(清单路径)) throw new Error(`没有待登记清单：${path.relative(项目根, 清单路径)}（先跑 scripts/生成待登记清单.js）`);
  const 条目 = fs.readFileSync(清单路径, "utf8").trim().split("\n").filter(Boolean)
    .map((行) => { try { return JSON.parse(行); } catch (_错误) { return null; } })
    .filter(Boolean)
    .filter((项) => String(项.订单号 || "").trim() === String(订单号).trim());
  if (!条目.length) throw new Error(`待登记清单里没有订单号 ${订单号}（先跑 scripts/生成待登记清单.js 把单子算出来）`);
  return 条目[条目.length - 1];
}

function 落证据(结果) {
  try {
    fs.mkdirSync(证据目录, { recursive: true });
    const 文件 = path.join(证据目录, `登记写入-${String(结果.订单号 || "未知").replace(/[^\w-]/g, "_")}.json`);
    fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), ...结果 }, null, 2), "utf8");
    return 文件;
  } catch (_错误) { return ""; }
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  // 写入走**独立脚本**（scripts.write）；只读查询脚本那份不动。
  const 跑写入脚本 = (argv) => 跑脚本(argv, { 脚本: "write" });
  if (参数.探针) {
    const 结果 = await 探针({ 跑脚本: 跑写入脚本 }, 参数.表名 || 默认表名);
    console.log(`\n  云端写入脚本探针：scriptVersion=${结果.scriptVersion || "未知"} mode=${结果.mode || "未知"}`);
    if (结果.sheet) console.log(`  表：${结果.sheet}　最后数据行：${结果.lastDataRow}　下一个可写行：${结果.nextWriteRow}`);
    if (结果.message) console.log(`  说明：${结果.message}`);
    console.log("");
    return;
  }
  const 条目 = 读清单条目(参数.订单号);
  const 结果 = await 写登记行(条目, { 跑脚本: 跑写入脚本, 生成写表数据 }, {
    已确认: 参数.已确认 === true,
    表名: 参数.表名 || 默认表名,
  });
  const 证据文件 = 落证据(结果);
  console.log(`\n  状态：${结果.状态}`);
  console.log(`  订单号：${结果.订单号}　表：${结果.表名}`);
  if (结果.行号) console.log(`  行号：第 ${结果.行号} 行`);
  if (结果.命中行) console.log(`  云端已有：第 ${结果.命中行} 行`);
  if (结果.原因) console.log(`  原因：${结果.原因}`);
  if (结果.说明) console.log(`  说明：${结果.说明}`);
  if (结果.列) {
    console.log("  将要写入的列（只写这些，公式列不碰）：");
    for (const [字母, 值] of Object.entries(结果.列)) console.log(`    ${字母}=${值}`);
  }
  if (结果.写入列 && 结果.写入列.length) console.log(`  已写入列：${结果.写入列.join("、")}`);
  if (结果.回读 && 结果.回读.length) console.log(`  写后回读：${结果.回读.join(" | ").slice(0, 300)}`);
  if (证据文件) console.log(`  证据：${path.relative(项目根, 证据文件)}`);
  console.log("");
  if (结果.状态 === "等授权") process.exitCode = 2;
  else if (结果.状态 === "已登记") process.exitCode = 3;
  else if (结果.状态 !== "已写入") process.exitCode = 4;
}

main().catch((错误) => {
  console.error(`\n  写入失败：${错误.message}\n`);
  process.exit(1);
});
