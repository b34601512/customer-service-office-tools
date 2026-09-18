#!/usr/bin/env node
// 用金山文档里已保存的「只读查询」AirScript 查订单号/关键字（服务端读全表，不受网页窗口加载限制）。
// 依赖：project-config/kdocs-airscript.json（{"webhookUrl":"...","apiToken":"..."}，不入库）；
//      脚本正文见 kdocs-scripts/AirScript-只读查询订单号.txt（在文档里粘一次、保存、生成 token）。
//
// 用法：
//   node src/tools/kdocs-query.js 5127667812586099609
//   node src/tools/kdocs-query.js 5127667812586099609 3316423947070006870
//   node src/tools/kdocs-query.js 5127667812586099609 --sheets "退货退款表,异常件"
//   node src/tools/kdocs-query.js 5127667812586099609 --out runtime/kdocs/query-<关键词>.json
const fs = require("fs");
const path = require("path");
const { runAirScript } = require("../engine/kdocsAirScript");
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");

function parseArgs(argv) {
  const args = { keywords: [], maxRows: 50000 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--sheets") { args.sheets = String(argv[index + 1] || "").split(",").map((name) => name.trim()).filter(Boolean); index += 1; continue; }
    if (token === "--out") { args.out = argv[index + 1]; index += 1; continue; }
    if (token === "--max-rows") { args.maxRows = Number(argv[index + 1]); index += 1; continue; }
    if (token.startsWith("--")) continue;
    args.keywords.push(token);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.keywords.length) {
    console.error("用法：node src/tools/kdocs-query.js <订单号> [更多订单号...] [--sheets \"退货退款表,异常件\"] [--out 文件]");
    process.exit(2);
  }
  const options = { keywords: args.keywords, maxRows: args.maxRows };
  if (args.sheets) options.sheets = args.sheets;
  log("金山查询", "开始", `关键词 ${args.keywords.length} 个`, args.sheets ? `表：${args.sheets.join("/")}` : "全部工作表");

  const result = await runAirScript([options]);
  log("金山查询", "完成", `扫描 ${result.scannedRows} 行 / ${result.checkedSheets} 个表，命中 ${result.matchCount} 行`);

  console.log(`\n  扫描：${result.checkedSheets} 个工作表 / ${result.scannedRows} 行`);
  console.log("  各表命中：");
  for (const item of result.sheetDetails || []) {
    if (item.hits) console.log(`    · ${item.sheet}：${item.hits} 行（扫 ${item.rows} 行）`);
  }
  console.log(`\n  命中合计：${result.matchCount} 行`);
  for (const match of result.matches || []) {
    console.log(`    【${match.sheet} 第 ${match.row} 行】${match.values.join(" | ").slice(0, 220)}`);
  }
  if (args.out) {
    const outPath = projectPath(args.out.replace("<关键词>", args.keywords[0]));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
    console.log(`\n  已保存：${path.relative(projectPath(), outPath)}`);
  }
  console.log("");
  process.exit(0);
}

main().catch((error) => {
  log("金山查询", "失败", error.message);
  console.error(`\n  查询失败：${error.message}\n`);
  process.exit(1);
});
