// 反向检查命令行：跑金山「只读筛选未退款」脚本，列出「退款表里有记录、但退款状态没填已退款」的行。
// 判据来源：用户 2026-09-18 口径——退款表有记录＝客户货已退回，退款状态没填「已退款」＝客服没处理。
//
// ⚠ 2026-09-30 收拢：**唯一出处**。22/24 号原来各有一份逐字相同的 `src/tools/kdocs-filter.js`（75 行 ×2，25号没有），
//    现在项目的那个文件只是薄壳（传 项目根 + log + runAirScript）。
//
// 依赖：project-config/kdocs-airscript.json 里 scripts.filterPendingRefund.webhookUrl
//       （脚本正文见 kdocs-scripts/AirScript-只读筛选未退款.md，用户已在金山里存为独立脚本）
//
// 用法（在项目里）：
//   node src/tools/kdocs-filter.js                       # 默认：退货退款表 / 状态列 22 / 已退款 / 样例 200
//   node src/tools/kdocs-filter.js --limit 500 --out runtime/kdocs/待提醒-未退款.json
//   node src/tools/kdocs-filter.js --sheet "退货退款表" --ok-status 已退款
// 注意：本工具只读、只输出清单，**不会发送任何消息**（发群前必须用户确认）。
const fs = require("fs");
const path = require("path");

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

/** 跑筛选命令行：调用方注入 项目根 / log / runAirScript（各项目薄壳）。返回 { exitCode, outPath } */
async function 跑筛选命令行({ argv = [], 项目根 = process.cwd(), log = () => {}, runAirScript } = {}) {
  if (!runAirScript) throw new Error("跑筛选命令行需要传 runAirScript（创建脚本客户端 的返回值里的那个）");
  const args = parseArgs(argv);
  const options = { limit: args.limit, maxRows: args.maxRows };
  if (args.startRow !== undefined) options.startRow = args.startRow;
  if (args.sheetName) options.sheetName = args.sheetName;
  if (args.statusColumnIndex !== undefined) options.statusColumnIndex = args.statusColumnIndex;
  if (args.orderColumnIndex !== undefined) options.orderColumnIndex = args.orderColumnIndex;
  if (args.okStatusText) options.okStatusText = args.okStatusText;

  log("未退款筛选", "开始", options.sheetName || "退货退款表", `状态列 ${options.statusColumnIndex === undefined ? 22 : options.statusColumnIndex}`);

  // 2026-10-30 加：**翻页扫全表**。
  //   起因：0.1 版云端脚本把 maxRows 既当「扫多少行」又当「绝对末行」，表一大就停在上限附近，
  //   而调用方看到的只是「扫了 50000 行」，分不清是表到底了还是被截断 → 结果不可信。
  //   现在：脚本回 bounds{lastRow, scannedTo, hasMore, nextStartRow}，这里按 nextStartRow 一段段扫到底，
  //   扫完用「各页 scannedRows 之和 == lastRow-1」对账，不等直接报错（不静默给半张表）。
  //   旧脚本（没有 bounds）照旧单次调用，行为不变。
  const 各页 = [];
  const 合并计数 = (目标, 源) => {
    for (const key of Object.keys(源 || {})) 目标[key] = (目标[key] || 0) + 源[key];
    return 目标;
  };
  let 页码 = 0;
  let 本次 = { ...options };
  for (;;) {
    页码 += 1;
    if (页码 > 60) throw new Error("翻页超过 60 段仍未到底，停下查原因（别拿半张表当结论）");
    const 段 = await runAirScript(本次, { script: "filterPendingRefund" });
    各页.push(段);
    const 界 = 段.bounds;
    if (!界 || typeof 界.hasMore !== "boolean") break; // 旧脚本：没有分页信息，单次为准
    if (!界.hasMore) break;
    本次 = { ...本次, startRow: 界.nextStartRow, endRow: 0, limit: 0 };
  }

  const result = 各页[0];
  let summary = result.summary || {};
  if (各页.length > 1) {
    const 合并 = { scannedRows: 0, rowsWithOrder: 0, pendingCount: 0, statusCounts: {} };
    const 样例 = [];
    for (const 段 of 各页) {
      const 段汇总 = 段.summary || {};
      合并.scannedRows += 段汇总.scannedRows || 0;
      合并.rowsWithOrder += 段汇总.rowsWithOrder || 0;
      合并.pendingCount += 段汇总.pendingCount || 0;
      合并计数(合并.statusCounts, 段汇总.statusCounts);
      for (const item of 段.samples || []) 样例.push(item);
    }
    summary = 合并;
    result.samples = 样例.slice(0, options.limit);
    const 界 = 各页[0].bounds;
    if (界 && 界.lastRow) {
      const 应为 = 界.lastRow - 1;
      if (合并.scannedRows !== 应为) {
        throw new Error(`翻页对账失败：各页合计扫了 ${合并.scannedRows} 行，但表末行是 ${界.lastRow}（应为 ${应为} 行）。不拿这张表下结论，先查为什么有缺口。`);
      }
      log("未退款筛选", "翻页完成", `共 ${各页.length} 页 / 表末行 ${界.lastRow}`, `扫 ${合并.scannedRows} 行（已对账）`);
    }
  }
  log("未退款筛选", "完成", `扫 ${summary.scannedRows} 行 / 有记录 ${summary.rowsWithOrder} 行`, `未退款 ${summary.pendingCount} 行`);

  console.log(`\n  脚本版本：${result.scriptVersion}｜表：${result.sheetName}｜列索引：${JSON.stringify(result.columnIndexes)}`);
  if (result.header && result.header.length) {
    const shown = result.header.map((text, index) => `${index}:${text}`).filter((item) => !/^(\d+):$/.test(item));
    console.log(`  表头：${shown.join(" | ").slice(0, 500)}`);
  }
  console.log("\n  状态分布（有记录的行）：");
  const counts = summary.statusCounts || {};
  for (const key of Object.keys(counts).sort((left, right) => counts[right] - counts[left])) {
    console.log(`    ${key || "(空)"} → ${counts[key]}`);
  }
  console.log(`\n  未退款合计：${summary.pendingCount} 行（下面列出前 ${(result.samples || []).length} 行样例）`);
  for (const item of result.samples || []) {
    console.log(`    [第${item.row}行] ${item.platform} | ${item.customer} | ${item.orderId} | 状态=${item.status} | 退款额=${item.refundAmount || "-"} | 退款时间=${item.refundTime || "-"}`);
  }

  const outPath = path.resolve(项目根, args.out || "runtime/kdocs/待提醒-未退款.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sheetName: result.sheetName, header: result.header, summary, samples: result.samples }, null, 2), "utf8");
  console.log(`\n  已保存：${path.relative(项目根, outPath)}`);
  console.log("  （本工具只出清单，不发消息）\n");
  return { exitCode: 0, outPath };
}

module.exports = { 跑筛选命令行, parseArgs };
