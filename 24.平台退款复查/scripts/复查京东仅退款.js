#!/usr/bin/env node
// 24号 京东「仅退款」漏退回复查（用户 2026-09-27 口径，照他以前的手工流程）：
//   清单（各店 仅退款+退款成功+已出库）→ 匹配两个来源：
//     ① 京东仓退货表（runtime/jd/京东仓退货明细-*.json，工具 jd-warehouse-returns.js）
//     ② 金山《2026年【湖南怀化售后】对接表》（AirScript 只读全表查，工具 kdocs-query.js）
//   → 两边都匹配不到 = **0 = 漏退回，重点看**；匹配到 = 1 = 货已收到（京东仓或怀化仓）。
//
// 用法：
//   node scripts/复查京东仅退款.js                      # 全部店，跑金山查询
//   node scripts/复查京东仅退款.js --skip-kdocs          # 只看京东仓（不查金山，快）
//   node scripts/复查京东仅退款.js --batch-size 10       # 金山批量关键词数（实测 20 会 403，10 稳）
//
// 只读：不动平台、不写金山。
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { projectPath } = require("../src/config/stores");
const { rowMatchesOrder, normalizeOrderNo } = require("../src/features/review/orderNoMatch");
const { log } = require("../src/engine/log");

function parseArgs(argv) {
  const args = { stores: "jd1,jd2,jd3,jd6,jd8", batchSize: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "skip-kdocs") { args.skipKdocs = true; continue; }
    if (key === "skip-warehouse") { args.skipWarehouse = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "stores") args.stores = value;
    else if (key === "batch-size") args.batchSize = Number(value);
    else if (key === "out") args.out = value;
  }
  return args;
}

function stamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function latestFile(dirParts, prefix, suffix = ".json") {
  const full = projectPath(...dirParts);
  if (!fs.existsSync(full)) return "";
  const files = fs.readdirSync(full).filter((name) => name.startsWith(prefix) && name.endsWith(suffix)).sort();
  return files.length ? path.join(full, files[files.length - 1]) : "";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runStamp = stamp();
  const stores = args.stores.split(",").map((s) => s.trim()).filter(Boolean);

  // 1) 各店最新「仅退款+已出库」清单
  const items = [];
  for (const store of stores) {
    const file = latestFile(["runtime", "jd"], `仅退款已出库清单-${store}-`);
    if (!file) { console.log(`  ⚠ ${store} 还没有清单（先跑 src/tools/jd-refund-list.js --store ${store}）`); continue; }
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const item of data.items || []) items.push({ store, listFile: path.basename(file), ...item });
    console.log(`  ${store}：读清单 ${path.basename(file)}（${(data.items || []).length} 单）`);
  }
  const orderIds = [...new Set(items.map((item) => item.orderId).filter(Boolean))];
  console.log(`  合计唯一订单号：${orderIds.length} 个`);
  if (!orderIds.length) throw new Error("没有订单号可查");

  // 2) 京东仓退货表（本地匹配）
  const warehouseFile = args.skipWarehouse ? "" : latestFile(["runtime", "jd"], "京东仓退货明细-");
  const warehouseByOrder = new Map();
  if (warehouseFile) {
    const data = JSON.parse(fs.readFileSync(warehouseFile, "utf8"));
    for (const row of data.items || []) {
      const key = normalizeOrderNo(row["销售平台单号"]);
      if (!key) continue;
      if (!warehouseByOrder.has(key)) warehouseByOrder.set(key, []);
      warehouseByOrder.get(key).push(row);
    }
    console.log(`  京东仓退货表：${path.basename(warehouseFile)}（${(data.items || []).length} 行）`);
  } else {
    console.log("  ⚠ 没有京东仓退货表（先跑 src/tools/jd-warehouse-returns.js）");
  }

  // 3) 金山《售后对接表》（AirScript 只读全表查，批量 10 个关键词）
  let kdocsMatches = [];
  if (!args.skipKdocs) {
    const chunks = [];
    for (let index = 0; index < orderIds.length; index += args.batchSize) chunks.push(orderIds.slice(index, index + args.batchSize));
    const merged = { scriptVersion: "", matches: [], batches: [] };
    for (const chunk of chunks) {
      const batchFile = projectPath("runtime", "jd", `怀化查询-${runStamp}-${chunk[0]}.json`);
      try {
        execFileSync(process.execPath, ["src/tools/kdocs-query.js", ...chunk, "--out", path.relative(projectPath(), batchFile)], { cwd: projectPath(), encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
        const batch = JSON.parse(fs.readFileSync(batchFile, "utf8"));
        merged.scriptVersion = batch.scriptVersion || merged.scriptVersion;
        merged.matches.push(...(batch.matches || []));
        merged.batches.push({ chunk, hits: (batch.matches || []).length, scannedRows: batch.scannedRows });
      } catch (error) {
        // 金山工具可能因 libuv 断言让退出码非 0，但产物已落盘（22号经验：以产物为准）
        if (fs.existsSync(batchFile)) {
          try {
            const batch = JSON.parse(fs.readFileSync(batchFile, "utf8"));
            merged.scriptVersion = batch.scriptVersion || merged.scriptVersion;
            merged.matches.push(...(batch.matches || []));
            merged.batches.push({ chunk, hits: (batch.matches || []).length, note: "退出码非0但产物已落盘" });
            continue;
          } catch { /* 产物不可读才算失败 */ }
        }
        merged.batches.push({ chunk, error: String(error.message || error).split("\n")[0] });
        console.log(`    ⚠ 金山查询失败：${String(error.message || error).split("\n")[0]}`);
      }
    }
    kdocsMatches = merged.matches;
    const outQuery = projectPath("runtime", "jd", `怀化查询-${runStamp}.json`);
    fs.writeFileSync(outQuery, JSON.stringify(merged, null, 2), "utf8");
    console.log(`  金山查询：${chunks.length} 批，命中 ${kdocsMatches.length} 行（脚本版本 ${merged.scriptVersion}）`);
  }

  // 4) 判定 0/1
  const results = [];
  for (const item of items) {
    const key = normalizeOrderNo(item.orderId);
    const warehouseRows = warehouseByOrder.get(key) || [];
    const huaihuaRows = kdocsMatches.filter((m) => rowMatchesOrder(m.values, item.orderId));
    const received = warehouseRows.length > 0 || huaihuaRows.length > 0;
    results.push({ ...item, received, warehouseRows, huaihuaRows });
  }
  const summary = {
    总单数: results.length,
    已收到货: results.filter((r) => r.received).length,
    漏退回: results.filter((r) => !r.received).length,
    京东仓命中: results.filter((r) => r.warehouseRows.length).length,
    怀化表命中: results.filter((r) => r.huaihuaRows.length).length
  };

  const report = {
    generatedAt: new Date().toISOString(),
    condition: "京东各店：客户期望=仅退款（未收货退款/已收货退款）+ 退款状态=退款成功 + 发货物流=已出库",
    warehouseFile: warehouseFile ? path.relative(projectPath(), warehouseFile) : null,
    kdocsBatches: args.skipKdocs ? null : "见 runtime/jd/怀化查询-*.json",
    summary,
    results
  };
  const jsonFile = projectPath("runtime", "review", `复查报告-jd仅退款-${runStamp}.json`);
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), "utf8");

  const mdLines = [
    `# 京东「仅退款」漏退回复查（${runStamp}）`,
    "",
    `条件：${report.condition}`,
    "",
    `**总 ${summary.总单数} 单 ｜ 已收到货 ${summary.已收到货}（京东仓 ${summary.京东仓命中} / 怀化表 ${summary.怀化表命中}）｜ ⚠ 漏退回 ${summary.漏退回}**`,
    "",
    "## 漏退回（0 = 两个来源都没匹配到，重点看）",
    "",
    "| 订单号 | 店铺 | 售后单号 | 金额 | 申请时间 | 商品 | 状态 |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];
  const missing = results.filter((r) => !r.received);
  for (const item of missing) {
    mdLines.push(`| ${item.orderId} | ${item.store} | ${item.serviceOrderId} | ¥${item.actualPayAmount ?? "-"} | ${(item.applyTime || "").slice(0, 10)} | ${String(item.wareName || "").slice(0, 30)} | ${item.afsStatusTitle || ""} |`);
  }
  mdLines.push("", "## 已收到货（1 = 京东仓或怀化表有记录）", "");
  for (const item of results.filter((r) => r.received)) {
    const where = [];
    if (item.warehouseRows.length) where.push(`京东仓 ${item.warehouseRows.map((row) => row["ECLP退货单号"]).join("/")}`);
    if (item.huaihuaRows.length) where.push(`怀化表第 ${item.huaihuaRows.map((row) => row.row).join("/")} 行`);
    mdLines.push(`- ${item.orderId}（${item.store}）→ ${where.join("；")}`);
  }
  const mdFile = projectPath("runtime", "review", `复查报告-jd仅退款-${runStamp}.md`);
  fs.writeFileSync(mdFile, mdLines.join("\n"), "utf8");

  log("京东仅退款复查", "完成", `总 ${summary.总单数}｜已收到 ${summary.已收到货}｜漏退回 ${summary.漏退回}`, path.relative(projectPath(), mdFile));
  console.log(`\n  ===== 京东「仅退款」漏退回复查 =====`);
  console.log(`    总 ${summary.总单数} ｜ 已收到货 ${summary.已收到货}（京东仓 ${summary.京东仓命中} / 怀化表 ${summary.怀化表命中}）｜ ⚠ 漏退回 ${summary.漏退回}`);
  console.log(`\n  报告：${path.relative(projectPath(), mdFile)}\n  数据：${path.relative(projectPath(), jsonFile)}\n`);
  return report;
}

main();
