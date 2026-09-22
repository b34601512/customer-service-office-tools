#!/usr/bin/env node
// 一条命令扫全部门店的天猫售后概览（只读）。
// 用法：node scripts/checkTmallAllStores.js [--with-pending]
// 说明：逐个店铺读后台「售后单统计」，重点看「24小时内待处理」——为 0 即没有"签收超 24h 没处理"的单。
//
// 根因修复（2026-09-22 实测两处假阴性，反向断言见 tests/checkConclusionMustNotPassOnNull.test.js）：
//   1) 工具失败时仍然打印**上一轮遗留的旧 JSON**，得出「✓ 全部门店无漏」——现在只认本轮刚写出来的文件；
//   2) stats 读到 null（页面没渲染统计标签）时，`null > 0` 为假 → 被算进“通过”——现在 null/失败一律不算通过，
//      结论必须写明哪家没读到，绝不给「无漏」。
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { listStores, projectPath } = require("../src/config/stores");

// 页面文本没读到标签时 pickNumber 返回 null；数字 0 是“真的没有单”，两者绝不能混为一谈。
function 读数有效(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// 只认「本轮开始之后才落盘」的概览文件，旧文件一律当没读到。
function 是本轮新数据(fullPath, 本轮开始时间) {
  if (!fs.existsSync(fullPath)) return false;
  return fs.statSync(fullPath).mtimeMs >= 本轮开始时间 - 1000;
}

function 构建结论(rows) {
  const 无效 = rows.filter((row) => !row.ok || !读数有效(row.stats?.["24小时内待处理"]));
  const 有效 = rows.filter((row) => row.ok && 读数有效(row.stats?.["24小时内待处理"]));
  const 有超时 = 有效.filter((row) => row.stats["24小时内待处理"] > 0);

  if (无效.length) {
    return {
      ok: false,
      text: `⚠ ${无效.map((row) => row.name).join("、")} 没读到有效统计（登录态失效/页面没渲染），**不能下“无漏”结论**；有效结果：${有效.map((row) => `${row.name}=${row.stats["24小时内待处理"]}`).join("、") || "无"}`,
    };
  }
  if (有超时.length) {
    return { ok: false, text: `⚠ ${有超时.map((row) => row.name).join("、")} 有临近超时的单，需要去后台看` };
  }
  return { ok: true, text: "✓ 全部门店都没有签收超 24h 未处理的单（无误漏）" };
}

function main() {
  const withPending = process.argv.includes("--with-pending");
  const stores = listStores().filter((item) => item.platformKey === "tmall");
  console.log(`\n  天猫店铺 ${stores.length} 个：${stores.map((s) => s.key).join("、")}\n`);

  const rows = [];
  for (const store of stores) {
    const outFile = `runtime/tmall/概览-${store.key}.json`;
    const full = projectPath(outFile);
    const 本轮开始时间 = Date.now();
    if (fs.existsSync(full)) fs.unlinkSync(full); // 先删旧文件，杜绝把上一轮结果当本轮
    let 失败原因 = "";
    try {
      execFileSync("node", ["src/tools/tmall-refund-overview.js", "--store", store.key, "--out", outFile, ...(withPending ? ["--probe-pending"] : [])], { encoding: "utf8" });
    } catch (error) {
      失败原因 = String(error.message).split("\n")[0].slice(0, 90);
      console.log(`  ✗ ${store.key}（${store.name}）读取失败：${失败原因}`);
    }

    if (!是本轮新数据(full, 本轮开始时间)) {
      rows.push({ key: store.key, name: store.name, ok: false, stats: {}, checkedAt: null, reason: 失败原因 || "概览文件不是本轮生成" });
      continue;
    }
    const data = JSON.parse(fs.readFileSync(full, "utf8"));
    const ok = !失败原因 && 读数有效(data.stats?.["24小时内待处理"]);
    rows.push({ key: store.key, name: store.name, ok, stats: data.stats, checkedAt: data.checkedAt, reason: 失败原因 || (ok ? "" : "页面未读到统计标签") });
  }

  console.log("\n  ===== 天猫售后概览汇总 =====");
  console.log("  店铺                  24h内待处理  待处理售后  退款待处理  待收货  待买家处理  退款时长");
  for (const row of rows) {
    const 眼见 = (值) => (值 === undefined || 值 === null ? "-" : 值);
    const value = row.stats["24小时内待处理"];
    const flag = row.ok && value === 0 ? "✓" : "⚠";
    console.log(`  ${flag} ${String(row.name).padEnd(16)} ${String(眼见(value)).padStart(6)} ${String(眼见(row.stats["待处理售后"])).padStart(9)} ${String(眼见(row.stats["退款待处理"])).padStart(9)} ${String(眼见(row.stats["待收货"])).padStart(7)} ${String(眼见(row.stats["待买家处理"])).padStart(9)} ${String(眼见(row.stats["退款处理时长(h)"])).padStart(8)}`);
  }
  const conclusion = 构建结论(rows);
  console.log(`\n  结论：${conclusion.text}\n`);
  process.exitCode = conclusion.ok ? 0 : 1;
}

if (require.main === module) main();

module.exports = { 构建结论, 读数有效, 是本轮新数据 };
