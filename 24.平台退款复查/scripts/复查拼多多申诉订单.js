#!/usr/bin/env node
// 24号 拼多多可申诉订单 · 货物安全复查（只读编排，平台实现见 src/features/review/reviewPipeline.js）。
//
// 用法：
//   node scripts/复查拼多多申诉订单.js --stores pdd02,pdd03
//   node scripts/复查拼多多申诉订单.js --stores pdd02 --orders runtime/pdd/订单号.txt
//   node scripts/复查拼多多申诉订单.js --stores pdd02 --skip-erp --skip-kdocs     # 只出清单
const { runReview } = require("../src/features/review/reviewPipeline");

function parseArgs(argv) {
  const args = { stores: "pdd02,pdd03" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "skip-erp") { args.skipErp = true; continue; }
    if (key === "skip-kdocs") { args.skipKdocs = true; continue; }
    if (key === "skip-notes") { args.skipNotes = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "stores") args.stores = value;
    else if (key === "orders") args.orders = value;
    else if (key === "out") args.out = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
runReview({ platform: "pdd", ...args });
