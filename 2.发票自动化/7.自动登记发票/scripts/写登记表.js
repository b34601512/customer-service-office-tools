#!/usr/bin/env node
// 7号：把待登记清单里的一条**写进金山发票登记总表**（唯一会真写的脚本；默认不写，只给你看要写什么）。
//
// 安全闸门见 `src/登记写入.js`：字段不全拒写 → 没授权不写 → 云端查重命中拒写 → 写完回读必须 1 行。
//
// 用法：
//   node scripts/写登记表.js --订单号 <单号> --表 "科技--唐雪梅" --脚本 write_jituan --读脚本 query_jituan --已确认 --验收 --行 10497
//        ↑ --行：修复场景专用（云端只允许写空行或同一单号那一行）
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
const { 抓快照, 对比快照 } = require("../src/写入验收");

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
    if (词 === "--脚本") { 结果.脚本 = argv[i + 1]; i += 1; continue; }
    if (词 === "--验收") { 结果.验收 = true; continue; }
    if (词 === "--读脚本") { 结果.读脚本 = argv[i + 1]; i += 1; continue; }
    if (词 === "--行") { 结果.行 = Number(argv[i + 1]); i += 1; continue; }
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

function 落证据(结果, 后缀 = "") {
  try {
    fs.mkdirSync(证据目录, { recursive: true });
    const 文件 = path.join(证据目录, `登记写入-${String(结果.订单号 || "未知").replace(/[^\w-]/g, "_")}${后缀}.json`);
    fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), ...结果 }, null, 2), "utf8");
    return 文件;
  } catch (_错误) { return ""; }
}

// 写前/写后验收（用户 2026-09-30：写前记录 → 写后记录 → 对比，避免覆盖别人的行）
async function 跑验收(参数, 条目, 表名, 跑写入脚本) {
  const 读脚本键 = 参数.读脚本 || "query";
  const 跑读脚本 = (argv) => 跑脚本(argv, { 脚本: 读脚本键 });
  const 探针结果 = await 探针({ 跑脚本: 跑写入脚本 }, 表名);
  const 目标行 = Number(探针结果 && 探针结果.nextWriteRow) || 0;
  if (!目标行) throw new Error("验收失败：探针没给出「下一个可写行」，不能写（先把 --表/--脚本 配对）。");
  const 期望列 = {};
  for (const [字母, 项] of Object.entries(生成写表数据(条目, { 表名 }).列 || {})) {
    if (项 && 项.值 !== undefined) 期望列[字母] = 项.值;
  }
  const 起 = Math.max(1, 目标行 - 2);
  const 止 = 目标行 + 2;
  const 写前 = await 抓快照(跑读脚本, 表名, 起, 止);
  落证据({ 订单号: 条目.订单号, 表名, 目标行, 探针: 探针结果, 快照: 写前 }, "-写前");
  console.log(`\n  写前记录：目标行 ${目标行}（探针 nextWriteRow）；已存快照 第 ${起}~${止} 行`);
  const 前邻行 = Object.entries(写前.行).map(([号, 值]) => `    · 第 ${号} 行：J=${值.J || "(空)"}`).join("\n");
  console.log(前邻行);

  const 写入结果 = await 写登记行(条目, { 跑脚本: 跑写入脚本, 生成写表数据 }, {
    已确认: 参数.已确认 === true,
    表名,
    行: 参数.行,
  });
  if (写入结果.状态 !== "已写入") {
    console.log(`\n  状态：${写入结果.状态}（未进入写后验收）`);
    if (写入结果.原因) console.log(`  原因：${写入结果.原因}`);
    if (写入结果.说明) console.log(`  说明：${写入结果.说明}`);
    if (写入结果.命中行) console.log(`  云端已有：第 ${写入结果.命中行} 行`);
    console.log("");
    process.exitCode = 写入结果.状态 === "等授权" ? 2 : 3;
    return;
  }

  const 写后 = await 抓快照(跑读脚本, 表名, 起, 止);
  const 写后探针 = await 探针({ 跑脚本: 跑写入脚本 }, 表名);
  写后.下一个可写行 = Number(写后探针 && 写后探针.nextWriteRow) || 0;
  const 对比 = 对比快照(写前, 写后, Number(写入结果.行号) || 目标行, 期望列, 1);
  const 写后文件 = 落证据({ 订单号: 条目.订单号, 表名, 目标行, 探针: 写后探针, 快照: 写后, 对比 }, "-写后");

  console.log(`\n  写入成功：第 ${写入结果.行号} 行｜列 ${(写入结果.写入列 || []).join("、")}`);
  console.log(`  写后记录：下一个可写行 ${写后探针.nextWriteRow}`);
  console.log(`  验收对比：${对比.通过 ? "✓ 通过（只有第 " + 对比.目标行 + " 行按预期变化，其它行一字未动）" : "✗ 未通过"}`);
  for (const 问题 of 对比.问题) console.log(`    ✗ ${问题}`);
  console.log(`  证据：写前/写后各一份（runtime/登记写入-${条目.订单号}-写前.json / -写后.json）`);
  console.log("");
  if (!对比.通过) process.exitCode = 1;
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 脚本键 = 参数.脚本 || "write";
  // 写入走**独立脚本**（默认 scripts.write；集团表是 scripts.write_jituan）；只读查询脚本那份不动。
  const 跑写入脚本 = (argv) => 跑脚本(argv, { 脚本: 脚本键 });
  if (参数.探针) {
    const 结果 = await 探针({ 跑脚本: 跑写入脚本 }, 参数.表名 || 默认表名);
    console.log(`\n  云端写入脚本探针：scriptVersion=${结果.scriptVersion || "未知"} mode=${结果.mode || "未知"}`);
    if (结果.sheet) console.log(`  表：${结果.sheet}　最后数据行：${结果.lastDataRow}　下一个可写行：${结果.nextWriteRow}`);
    if (结果.message) console.log(`  说明：${结果.message}`);
    console.log("");
    return;
  }
  const 条目 = 读清单条目(参数.订单号);
  const 表名 = 参数.表名 || 默认表名;
  if (参数.验收) {
    await 跑验收(参数, 条目, 表名, 跑写入脚本);
    return;
  }
  const 结果 = await 写登记行(条目, { 跑脚本: 跑写入脚本, 生成写表数据 }, {
    已确认: 参数.已确认 === true,
    表名,
    行: 参数.行,
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
