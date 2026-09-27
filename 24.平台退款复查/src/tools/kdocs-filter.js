#!/usr/bin/env node
// 反向检查：跑金山「只读筛选未退款」脚本，列出「退款表里有记录、但退款状态没填已退款」的行。
// 判据来源：用户 2026-09-18 口径——退款表有记录＝客户货已退回，退款状态没填「已退款」＝客服没处理。
//
// 依赖：project-config/kdocs-airscript.json 里 scripts.filterPendingRefund.webhookUrl
//       （脚本正文见 kdocs-scripts/AirScript-只读筛选未退款.md，用户已在金山里存为独立脚本）
//
// 用法：
//   node src/tools/kdocs-filter.js                       # 默认：退货退款表 / 状态列 22 / 已退款 / 样例 200
//   node src/tools/kdocs-filter.js --limit 500 --out runtime/kdocs/待提醒-未退款.json
//   node src/tools/kdocs-filter.js --sheet "退货退款表" --ok-status 已退款
// 注意：本工具只读、只输出清单，**不会发送任何消息**（发群前必须用户确认）。
const fs = require("fs");
const path = require("path");
const { runAirScript } = require("../engine/kdocsAirScript");
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");

function parseArgs(argv) {
  const args = { limit: 200, maxRows: 50000 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--limit") { args.limit = Number(argv[index + 1]); index += 1; continue; }
    if (token === "--max-rows") { args.maxRows = Number(argv[index + 1]); index += 1; continue; }
    if (token === "--start-row") { args.startRow = Number(argv[index + 1]); index += 1; continue; }
    if (token === "--sheet") { args.sheetName = argv[index + 1]; index += 1; continue; }
    if (token === "--status-column") { args.statusColumnIndex = Number(argv[index + 1]); index += 1; continue; }
    if (token === "--order-column") { args.orderColumnIndex = Number(argv[index + 1]); index += 1; continue; }
    if (token === "--ok-status") { args.okStatusText = argv[index + 1]; index += 1; continue; }
    if (token === "--out") { args.out = argv[index + 1]; index += 1; continue; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = { limit: args.limit, maxRows: args.maxRows };
  if (args.startRow !== undefined) options.startRow = args.startRow;
  if (args.sheetName) options.sheetName = args.sheetName;
  if (args.statusColumnIndex !== undefined) options.statusColumnIndex = args.statusColumnIndex;
  if (args.orderColumnIndex !== undefined) options.orderColumnIndex = args.orderColumnIndex;
  if (args.okStatusText) options.okStatusText = args.okStatusText;

  log("未退款筛选", "开始", options.sheetName || "退货退款表", `状态列 ${options.statusColumnIndex === undefined ? 22 : options.statusColumnIndex}`);
  const result = await runAirScript(options, { script: "filterPendingRefund" });
  const summary = result.summary || {};
  log("未退款筛选", "完成", `扫 ${summary.scannedRows} 行 / 有记录 ${summary.rowsWithOrder} 行`, `未退款 ${summary.pendingCount} 行`);

  console.log(`\n  脚本版本：${result.scriptVersion}｜表：${result.sheetName}｜列索引：${JSON.stringify(result.columnIndexes)}`);
  if (result.header && result.header.length) {
    const shown = result.header.map((text, index) => `${index}:${text}`).filter((item) => !/^(\d+):$/.test(item));
    console.log(`  表头：${shown.join(" | ").slice(0, 500)}`);
  }
  console.log(`\n  状态分布（有记录的行）：`);
  const counts = summary.statusCounts || {};
  for (const key of Object.keys(counts).sort((left, right) => counts[right] - counts[left])) {
    console.log(`    ${key || "(空)"} → ${counts[key]}`);
  }
  console.log(`\n  未退款合计：${summary.pendingCount} 行（下面列出前 ${(result.samples || []).length} 行样例）`);
  for (const item of result.samples || []) {
    console.log(`    [第${item.row}行] ${item.platform} | ${item.customer} | ${item.orderId} | 状态=${item.status} | 退款额=${item.refundAmount || "-"} | 退款时间=${item.refundTime || "-"}`);
  }

  const outPath = projectPath(args.out || "runtime/kdocs/待提醒-未退款.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sheetName: result.sheetName, header: result.header, summary, samples: result.samples }, null, 2), "utf8");
  console.log(`\n  已保存：${path.relative(projectPath(), outPath)}`);
  console.log(`  （本工具只出清单，不发消息）\n`);
}

main().catch((error) => {
  log("未退款筛选", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
