#!/usr/bin/env node
// 一条命令扫全部门店的天猫售后概览（只读）。
// 用法：node scripts/checkTmallAllStores.js [--with-pending]
// 说明：逐个店铺读后台「售后单统计」，重点看「24小时内待处理」——为 0 即没有"签收超 24h 没处理"的单。
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { listStores, projectPath } = require("../src/config/stores");

const withPending = process.argv.includes("--with-pending");
const stores = listStores().filter((item) => item.platformKey === "tmall");
console.log(`\n  天猫店铺 ${stores.length} 个：${stores.map((s) => s.key).join("、")}\n`);

const rows = [];
for (const store of stores) {
  const outFile = `runtime/tmall/概览-${store.key}.json`;
  try {
    execFileSync("node", ["src/tools/tmall-refund-overview.js", "--store", store.key, "--out", outFile, ...(withPending ? ["--probe-pending"] : [])], { encoding: "utf8" });
  } catch (error) {
    console.log(`  ✗ ${store.key}（${store.name}）读取失败：${String(error.message).split("\n")[0].slice(0, 90)}`);
  }
  const full = projectPath(outFile);
  if (fs.existsSync(full)) {
    const data = JSON.parse(fs.readFileSync(full, "utf8"));
    rows.push({ key: store.key, name: store.name, ...data.stats, checkedAt: data.checkedAt });
  }
}

console.log("\n  ===== 天猫售后概览汇总 =====");
console.log("  店铺                  24h内待处理  待处理售后  退款待处理  待收货  待买家处理  退款时长");
for (const row of rows) {
  const flag = row["24小时内待处理"] === 0 ? "✓" : "⚠";
  console.log(`  ${flag} ${String(row.name).padEnd(16)} ${String(row["24小时内待处理"]).padStart(6)} ${String(row["待处理售后"]).padStart(9)} ${String(row["退款待处理"]).padStart(9)} ${String(row["待收货"]).padStart(7)} ${String(row["待买家处理"]).padStart(9)} ${String(row["退款处理时长(h)"]).padStart(8)}`);
}
const risky = rows.filter((row) => row["24小时内待处理"] > 0);
console.log(`\n  结论：${risky.length ? `⚠ ${risky.map((r) => r.name).join("、")} 有临近超时的单，需要去后台看` : "✓ 全部门店都没有签收超 24h 未处理的单（无误漏）"}\n`);
