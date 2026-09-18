#!/usr/bin/env node
// 把 probe-page 落盘的 page.txt（天猫退款管理列表的可见文本）解析成结构化售后单列表。
// 结构（2026-09-18 实测）：
//   售后单号 406822464977683289
//   订单编号 5127371102267014515
//   申请时间 2026-09-08 20:49:06
//   退货退款                     ← 类型（申请时间下一行的非空文本）
//   谢**                        ← 买家昵称
//   未审核 | 请审核               ← 状态
//
// 用法：
//   node src/tools/parse-tmall-orders.js                       # 用 runtime/probe 里最新的 page.txt
//   node src/tools/parse-tmall-orders.js <page.txt 路径>
//   node src/tools/parse-tmall-orders.js --out runtime/tmall/xxx.json
const fs = require("fs");
const path = require("path");
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");

function latestProbePage() {
  const probeRoot = projectPath("runtime", "probe");
  if (!fs.existsSync(probeRoot)) throw new Error("还没有 runtime/probe 目录，先跑 probe-page.js");
  const dirs = fs.readdirSync(probeRoot)
    .map((name) => ({ name, full: path.join(probeRoot, name), page: path.join(probeRoot, name, "page.txt") }))
    .filter((item) => fs.existsSync(item.page))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!dirs.length) throw new Error("runtime/probe 下没有 page.txt");
  return dirs[dirs.length - 1].page;
}

function parseOrders(text) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\u3000/g, " ").trim());
  const orders = [];
  for (let index = 0; index < lines.length; index += 1) {
    const afterSaleMatch = lines[index].match(/^售后单号\s*([0-9]{10,25})$/);
    if (!afterSaleMatch) continue;
    const item = { afterSaleId: afterSaleMatch[1], orderId: "", applyTime: "", type: "", status: "", buyer: "" };
    for (let cursor = index + 1; cursor < lines.length && cursor <= index + 12; cursor += 1) {
      const line = lines[cursor];
      const orderMatch = line.match(/^订单编号\s*([0-9]{10,25})$/);
      if (orderMatch) { item.orderId = orderMatch[1]; continue; }
      const timeMatch = line.match(/^申请时间\s*(.+)$/);
      if (timeMatch) {
        item.applyTime = timeMatch[1].trim();
        for (let typeCursor = cursor + 1; typeCursor < lines.length && typeCursor <= cursor + 3; typeCursor += 1) {
          if (lines[typeCursor]) { item.type = lines[typeCursor]; break; }
        }
        continue;
      }
      if (!item.buyer && /^[^\s|]+$/.test(line) && item.type && !/请审核|审核/.test(line) && line.length <= 12) item.buyer = line;
      if (/请审核|待商家处理|待买家|已拒绝|待收货|待举证/.test(line) && !item.status) item.status = line;
    }
    orders.push(item);
  }
  return orders;
}

function main() {
  const args = process.argv.slice(2);
  const showHelp = args.includes("--help");
  if (showHelp) {
    console.log("用法：node src/tools/parse-tmall-orders.js [page.txt] [--out 文件]");
    process.exit(0);
  }
  const target = args.find((item) => !item.startsWith("--") && item !== args[args.indexOf("--out") + 1]) || latestProbePage();
  const text = fs.readFileSync(path.isAbsolute(target) ? target : projectPath(target), "utf8");
  const orders = parseOrders(text);
  log("天猫列表解析", "完成", `来源 ${path.relative(projectPath(), path.isAbsolute(target) ? target : projectPath(target))}`, `共 ${orders.length} 单`);

  console.log(`\n  解析到 ${orders.length} 单：`);
  for (const item of orders) {
    console.log(`    ${item.afterSaleId} | ${item.orderId} | ${item.applyTime} | ${item.type} | ${item.status} | ${item.buyer}`);
  }
  const outIndex = args.indexOf("--out");
  if (outIndex >= 0 && args[outIndex + 1]) {
    const outPath = projectPath(args[outIndex + 1]);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ source: target, parsedAt: new Date().toISOString(), orders }, null, 2), "utf8");
    console.log(`\n  已保存：${path.relative(projectPath(), outPath)}`);
  }
  console.log("");
}

main();
