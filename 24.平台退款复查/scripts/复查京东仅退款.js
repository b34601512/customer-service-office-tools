#!/usr/bin/env node
// 24号 京东「仅退款」漏退回复查（用户 2026-09-27 口径，照他以前的手工流程）：
//   清单（各店 仅退款+退款成功+已出库）→ 匹配三个来源（2026-09-27 补撕单表，见下）：
//     ① 京东仓退货表（runtime/jd/京东仓退货明细-*.json，工具 jd-warehouse-returns.js）
//     ② 金山《2026年【湖南怀化售后】对接表》（AirScript 只读全表查，工具 kdocs-query.js）
//     ③ 金山《撕单表》（撕单 = 货没发走 = 安全；**用户 2026-09-27 点出必须查**）
//     ④ 金山《交接&跟进》表「快递问题」（**丢件已理赔 = 不用管**；用户 2026-09-27 点出必须查）
//   → 三个来源都匹配不到 = **0 = 漏退回，重点看**；命中 = 货已收到 / 已撕单 = 安全。
//   实测教训：只查①②时 44 单「漏退回」里 **28 单其实撕过单**（27「已撕」+1「货发走了，通知客服拦截」）。
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
const { loadTornRows, matchTornRows } = require("../src/features/review/tornSheet");
const { classifyDelivery } = require("../src/features/review/deliveryState");
const { loadCourierClaims, matchCourierClaims } = require("../src/features/review/courierClaim");
const { log } = require("../src/engine/log");

function parseArgs(argv) {
  const args = { stores: "jd1,jd2,jd3,jd6,jd8", batchSize: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "skip-kdocs") { args.skipKdocs = true; continue; }
    if (key === "skip-warehouse") { args.skipWarehouse = true; continue; }
    if (key === "skip-torn") { args.skipTorn = true; continue; }
    if (key === "skip-erp") { args.skipErp = true; continue; }
    if (key === "skip-claims") { args.skipClaims = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "stores") args.stores = value;
    else if (key === "batch-size") args.batchSize = Number(value);
    else if (key === "kdocs-results") args.kdocsResults = value;
    else if (key === "torn-file") args.tornFile = value;
    else if (key === "claim-file") args.claimFile = value;
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
  //    只查「京东仓没命中」的单——京东仓已确认收到的不用再查（省一半以上时间，实测 440→153）。
  const kdocsTargets = orderIds.filter((orderId) => !(warehouseByOrder.get(normalizeOrderNo(orderId)) || []).length);
  console.log(`  金山只需查 ${kdocsTargets.length} 单（京东仓已确认 ${orderIds.length - kdocsTargets.length} 单）`);
  let kdocsMatches = [];
  if (args.kdocsResults) {
    const reused = JSON.parse(fs.readFileSync(projectPath(args.kdocsResults), "utf8"));
    kdocsMatches = reused.matches || [];
    console.log(`  怀化表：复用 ${args.kdocsResults}（命中 ${kdocsMatches.length} 行，脚本版本 ${reused.scriptVersion || "?"}）`);
  } else if (!args.skipKdocs) {
    const chunks = [];
    for (let index = 0; index < kdocsTargets.length; index += args.batchSize) chunks.push(kdocsTargets.slice(index, index + args.batchSize));
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

  // 3.5) 金山《撕单表》（撕单 = 货没发走 = 安全；**这一步 2026-09-27 补，之前漏了**）
  let tornRows = [];
  if (!args.skipTorn) {
    try {
      tornRows = loadTornRows({ file: args.tornFile ? projectPath(args.tornFile) : "" });
      console.log(`  撕单表：${tornRows.length} 行`);
    } catch (error) {
      console.log(`  ⚠ 撕单表读取失败（继续，但结论可能偏严）：${String(error.message || error).split(String.fromCharCode(10))[0]}`);
    }
  }

  // 物流状态：漏退回的单还要看「货在路上没有」（用户 2026-09-27：还在路上不用管）
  //   判定规则与反向测试见 src/features/review/deliveryState.js + tests/deliveryState.test.js

  // 3.6) 金山《2026年【交接&跟进】表》→「快递问题」：丢件/破损是否已理赔（已理赔 = 不用管）
  let claimRows = [];
  if (!args.skipClaims) {
    try {
      claimRows = loadCourierClaims({ file: args.claimFile ? projectPath(args.claimFile) : "" });
      console.log(`  快递理赔表：${claimRows.length} 行（已理赔 ${claimRows.filter((r) => r.claimed).length} 行）`);
    } catch (error) {
      console.log(`  ⚠ 快递理赔表读取失败（继续，但结论可能偏严）：${String(error.message || error).split(String.fromCharCode(10))[0]}`);
    }
  }

  // 3.8) ERP：**只对三来源都没命中的单查**（作废 = 安全；实测 16 单里 1 单作废、1 单「邮费补差/无需物流」）
  let erpByOrder = new Map();
  if (!args.skipErp && args.kdocsResults) {
    // 复用模式（--kdocs-results）下先粗筛一遍未命中的，再查 ERP
    const roughMissing = orderIds.filter((orderId) => !(warehouseByOrder.get(normalizeOrderNo(orderId)) || []).length
      && !kdocsMatches.some((m) => rowMatchesOrder(m.values, orderId))
      && !matchTornRows(tornRows, orderId).length);
    if (roughMissing.length) {
      const ordersFile = projectPath("runtime", "jd", `漏退回待查ERP-${runStamp}.txt`);
      fs.writeFileSync(ordersFile, roughMissing.join(String.fromCharCode(10)), "utf8");
      const erpFile = projectPath("runtime", "jd", `ERP-漏退回-${runStamp}.json`);
      console.log(`  ERP：查 ${roughMissing.length} 单（只查三来源都没命中的）`);
      execFileSync(process.execPath, ["src/tools/erp-order-status.js", "--orders-file", path.relative(projectPath(), ordersFile), "--out", path.relative(projectPath(), erpFile)], { cwd: projectPath(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30 * 60 * 1000 });
      const erpData = JSON.parse(fs.readFileSync(erpFile, "utf8"));
      for (const order of erpData.orders || []) erpByOrder.set(normalizeOrderNo(order.platformCode), order);
    }
  }

  // 4) 判定：京东仓 / 怀化表 / 撕单表 都没命中 = 漏退回
  const results = [];
  for (const item of items) {
    const key = normalizeOrderNo(item.orderId);
    const warehouseRows = warehouseByOrder.get(key) || [];
    const huaihuaRows = kdocsMatches.filter((m) => rowMatchesOrder(m.values, item.orderId));
    const tornHits = matchTornRows(tornRows, item.orderId);
    const claimHits = matchCourierClaims(claimRows, item.orderId);
    const claimed = claimHits.some((row) => row.claimed);
    const erp = erpByOrder.get(key) || null;
    const received = warehouseRows.length > 0 || huaihuaRows.length > 0 || tornHits.length > 0;
    // ERP 作废 = 安全（项目判定链第①步）；其余原文进报告交模型/人读
    const erpCanceled = Boolean(erp && erp.cancel);
    results.push({ ...item, received, warehouseRows, huaihuaRows, tornRows: tornHits, claimRows: claimHits, claimed, erp, erpCanceled });
  }
  // 老清单（2026-09-27 16:05 前采集的）没有顶层字段 → 从原始行里兜底取
  const rawDeliveryState = (raw) => {
    let found = "";
    const walk = (obj) => {
      for (const [key, value] of Object.entries(obj || {})) {
        if (value && typeof value === "object" && !Array.isArray(value)) walk(value);
        else if (key === "deliveryWareStateName" && !found) found = String(value || "");
      }
    };
    walk(raw);
    return found;
  };
  for (const item of results) {
    const state = item.deliveryStateName || rawDeliveryState(item.raw);
    const verdict = classifyDelivery(state);
    item.deliveryStateName = state;
    item.deliveryVerdict = verdict.label;
    item.transit = !item.received && !item.claimed && verdict.kind === "in_transit";
    item.signedRisk = !item.received && !item.claimed && verdict.kind === "signed";
  }
  const summary = {
    总单数: results.length,
    已收到货: results.filter((r) => r.received).length,
    漏退回: results.filter((r) => !r.received).length,
    漏退回_ERP已作废: results.filter((r) => !r.received && r.erpCanceled).length,
    漏退回_在途不用管: results.filter((r) => r.transit && !r.erpCanceled).length,
    漏退回_已理赔: results.filter((r) => r.claimed && !r.received && !r.erpCanceled).length,
    漏退回_已签收风险: results.filter((r) => r.signedRisk && !r.erpCanceled).length,
    漏退回_ERP已发货: results.filter((r) => !r.received && r.erp && !r.erpCanceled).length,
    京东仓命中: results.filter((r) => r.warehouseRows.length).length,
    怀化表命中: results.filter((r) => r.huaihuaRows.length).length,
    撕单表命中: results.filter((r) => r.tornRows.length).length,
    快递已理赔: results.filter((r) => r.claimed).length,
    撕单表状态: results.flatMap((r) => r.tornRows.map((row) => row.status)).reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {})
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
    `**总 ${summary.总单数} 单 ｜ 已收到/已撕单 ${summary.已收到货}（京东仓 ${summary.京东仓命中} / 怀化表 ${summary.怀化表命中} / 撕单表 ${summary.撕单表命中}）｜ ⚠ 漏退回 ${summary.漏退回}**`,
    "",
    `对账：京东仓 ${summary.京东仓命中} + 怀化表 ${summary.怀化表命中} + 撕单表 ${summary.撕单表命中} + 漏退回 ${summary.漏退回} = ${summary.总单数}；漏退回里 ERP 已作废 ${summary.漏退回_ERP已作废} 单（= 安全）`,
    "",
    "## 漏退回（京东仓 / 怀化表 / 撕单表 三处都没命中 = 重点看）",
    "",
    "| 订单号 | 店铺 | 售后单号 | 金额 | 申请时间 | 物流状态 | 快递理赔 | 商品 | ERP（作废/审单/发货）| 结论 |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];
  const missing = results.filter((r) => !r.received);
  for (const item of missing) {
    const erpText = item.erp
      ? `${item.erp.cancel ? "★已作废" : "未作废"} / ${item.erp.approveState || "-"} / ${item.erp.deliveryLabel || "-"}${item.erp.expressName ? " / " + item.erp.expressName : ""}`
      : "（未查）";
    const verdictText = item.claimed ? "快递已理赔 = 不用管" : (item.erpCanceled ? "ERP 已作废 = 安全" : (item.deliveryVerdict || ""));
    mdLines.push(`| ${item.orderId} | ${item.store} | ${item.serviceOrderId} | ¥${item.actualPayAmount ?? "-"} | ${(item.applyTime || "").slice(0, 10)} | ${item.deliveryStateName || "-"} | ${item.claimRows.length ? item.claimRows.map((row) => `¥${row.claimAmount}（${row.claimWay}）`).join("/") : "-"} | ${String(item.wareName || "").slice(0, 30)} | ${erpText} | ${verdictText} |`);
  }
  mdLines.push("", "## 已收到 / 已撕单（有记录）", "");
  for (const item of results.filter((r) => r.received)) {
    const where = [];
    if (item.warehouseRows.length) where.push(`京东仓 ${item.warehouseRows.map((row) => row["ECLP退货单号"]).join("/")}`);
    if (item.huaihuaRows.length) where.push(`怀化表第 ${item.huaihuaRows.map((row) => row.row).join("/")} 行`);
    // 撕单状态是自由文本 → 原文贴出来，交模型/人读，不在这里判关键词
    for (const row of item.tornRows) where.push(`撕单表「${row.status}」（${row.date} 登记人 ${row.people} 店 ${row.shop}）`);
    mdLines.push(`- ${item.orderId}（${item.store}）→ ${where.join("；")}`);
  }
  const mdFile = projectPath("runtime", "review", `复查报告-jd仅退款-${runStamp}.md`);
  fs.writeFileSync(mdFile, mdLines.join("\n"), "utf8");

  log("京东仅退款复查", "完成", `总 ${summary.总单数}｜已收到 ${summary.已收到货}｜漏退回 ${summary.漏退回}`, path.relative(projectPath(), mdFile));
  console.log(`\n  ===== 京东「仅退款」漏退回复查 =====`);
  console.log(`    总 ${summary.总单数} ｜ 已收到/已撕单 ${summary.已收到货}（京东仓 ${summary.京东仓命中} / 怀化表 ${summary.怀化表命中} / 撕单表 ${summary.撕单表命中}）｜ ⚠ 漏退回 ${summary.漏退回}`);
  console.log(`    漏退回里：快递已理赔 ${summary.漏退回_已理赔} 单｜ERP 已作废 ${summary.漏退回_ERP已作废} 单（均 = 不用管）｜ 还在路上 ${summary.漏退回_在途不用管} 单（不用管）｜ 已签收 ${summary.漏退回_已签收风险} 单（真风险）`);
  console.log(`\n  报告：${path.relative(projectPath(), mdFile)}\n  数据：${path.relative(projectPath(), jsonFile)}\n`);
  return report;
}

main();
