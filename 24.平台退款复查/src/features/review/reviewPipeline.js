// 24号「申诉订单 · 货物安全复查」通用编排（只读）。
//
// 判定顺序（用户 2026-09-27 口径）：
//   ① ERP 已作废          → 安全（不会发货）
//   ② ERP 已审单/打单     → 看金山《撕单表》有没有撕单（撕单状态原文交模型读，脚本不写关键词判）
//   ③ ERP 已发货          → 查金山《2026年【湖南怀化售后】对接表》退货登记：
//                            搜得到 = 货已退回 → 安全；搜不到 = 风险（货发出且没退回）
// 平台差异只在：申诉清单目录/取单号字段/报告里怎么展示申诉信息。
//
// 用法（一般由 scripts/复查<平台>申诉订单.js 调用）：
//   runReview({ platform: "pdd", stores: ["pdd02"], ... })
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { projectPath } = require("../../config/stores");
const { classifyOrder } = require("./safetyClassify");
const { rowMatchesOrder } = require("./orderNoMatch");
const { TORN_SHEET_URL } = require("./tornSheet");

const PLATFORMS = {
  tmall: {
    title: "天猫退款申诉订单",
    listDir: ["runtime", "tmall"],
    listPrefix: "申诉清单-",
    orderIdPattern: /^\d{6,30}$/,
    extractOrders: (data) => (data.items || []).map((item) => item.orderId).filter(Boolean),
    appealText: (item) => `${item.refundId || "-"}/${item.handleType || "-"}/剩${item.leftHours}h`,
    collectHint: "src/tools/tmall-appeal-list.js --store <店>"
  },
  jd: {
    title: "京东可申诉订单",
    listDir: ["runtime", "jd"],
    listPrefix: "申诉清单-",
    orderIdPattern: /^\d{6,20}$/,
    extractOrders: (data) => (data.items || []).map((item) => item.orderId).filter(Boolean),
    appealText: (item) => `${item.tab || "-"}/${item.arbitTypeDesc || "-"}/${item.arbitStateDesc || "-"}/判责${item.arbitResultDesc || "-"}`,
    collectHint: "src/tools/jd-appeal-list.js --store <店>"
  },
  pdd: {
    title: "拼多多可申诉订单",
    listDir: ["runtime", "pdd"],
    listPrefix: "申诉清单-",
    orderIdPattern: /^\d{6,30}(-\d{3,30})?$/,
    extractOrders: (data) => (data.items || []).map((item) => item.orderSn).filter(Boolean),
    appealText: (item) => `${item.tab || "-"}/退款¥${item.refundAmountYuan ?? "-"}/剩${item.expireRemainHours}h`,
    collectHint: "src/tools/pdd-appeal-list.js --store <店>"
  }
};

function stamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function runNode(args, label) {
  console.log(`\n  ▶ ${label}`);
  const output = execFileSync(process.execPath, args, { cwd: projectPath(), encoding: "utf8", timeout: 15 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
  const tail = output.trim().split(/\r?\n/).slice(-8).join("\n");
  console.log(tail.split("\n").map((line) => `    ${line}`).join("\n"));
  return output;
}

function latestListFile(platformConfig, store) {
  const dir = projectPath(...platformConfig.listDir);
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir)
    .filter((name) => name.startsWith(`${platformConfig.listPrefix}${store}-`) && name.endsWith(".json"))
    .sort();
  return files.length ? path.join(dir, files[files.length - 1]) : "";
}

function readOrdersFromFile(file, pattern) {
  return Array.from(new Set(fs.readFileSync(file, "utf8").split(/[\s,，;；]+/).map((s) => s.trim()).filter((s) => pattern.test(s))));
}

function runReview(options) {
  const platformConfig = PLATFORMS[options.platform];
  if (!platformConfig) throw new Error(`不认识的平台：${options.platform}（可用 ${Object.keys(PLATFORMS).join(",")}）`);
  const stores = (options.stores || "").split(",").map((s) => s.trim()).filter(Boolean);
  const runStamp = stamp();

  // 1) 订单号来源：--orders 文件 或 各店最新的申诉清单
  let orderIds = [];
  const perStore = {};
  if (options.orders) {
    const file = path.isAbsolute(options.orders) ? options.orders : projectPath(options.orders);
    orderIds = readOrdersFromFile(file, platformConfig.orderIdPattern);
  } else {
    for (const store of stores) {
      const file = latestListFile(platformConfig, store);
      if (!file) { console.log(`  ⚠ ${store} 还没有申诉清单（先跑 ${platformConfig.collectHint.replace("<店>", store)}）`); continue; }
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      perStore[store] = { listFile: file, items: data.items || [] };
      for (const id of platformConfig.extractOrders(data)) orderIds.push(id);
      console.log(`  ${store}：读清单 ${path.basename(file)}（${(data.items || []).length} 条）`);
    }
    orderIds = Array.from(new Set(orderIds.filter((id) => platformConfig.orderIdPattern.test(id))));
  }
  if (!orderIds.length) throw new Error("没有订单号可查");
  console.log(`  合计订单号：${orderIds.length} 个`);

  // 2) ERP 状态
  let erp = { orders: [], missingOrders: orderIds, foundCount: 0 };
  if (!options.skipErp) {
    const ordersFile = projectPath("runtime", "review", `订单号-${runStamp}.txt`);
    fs.mkdirSync(path.dirname(ordersFile), { recursive: true });
    fs.writeFileSync(ordersFile, orderIds.join("\n"), "utf8");
    const outFile = projectPath("runtime", "review", `ERP状态-${runStamp}.json`);
    runNode(["src/tools/erp-order-status.js", "--orders-file", path.relative(projectPath(), ordersFile), "--out", path.relative(projectPath(), outFile)], "ERP 批量查状态");
    erp = JSON.parse(fs.readFileSync(outFile, "utf8"));
  }

  // 3) 金山《撕单表》（网页只读整表；实测 5608 行全量可读，够用）
  let tornRows = [];
  if (!options.skipKdocs) {
    const tornFile = projectPath("runtime", "review", `撕单表-${runStamp}.json`);
    runNode(["src/tools/read-kdocs.js", "--url", TORN_SHEET_URL, "--sheet", "撕单表", "--out", path.relative(projectPath(), tornFile)], "金山《撕单表》只读");
    const torn = JSON.parse(fs.readFileSync(tornFile, "utf8"));
    const matrix = torn.matrix || [];
    const header = (matrix[0] || []).map((x) => String(x || "").trim());
    const codeIndex = header.findIndex((h) => h.includes("平台单号"));
    const statusIndex = header.findIndex((h) => h.includes("撕单状态"));
    const dateIndex = header.findIndex((h) => h.includes("登记日期"));
    const reasonIndex = header.findIndex((h) => h.includes("撕单理由"));
    for (const row of matrix.slice(1)) {
      const code = codeIndex >= 0 ? String(row[codeIndex] || "").trim() : "";
      if (!code) continue;
      tornRows.push({
        code,
        date: dateIndex >= 0 ? String(row[dateIndex] || "") : "",
        status: statusIndex >= 0 ? String(row[statusIndex] || "") : "",
        reason: reasonIndex >= 0 ? String(row[reasonIndex] || "") : ""
      });
    }
  }

  // 4) 金山《售后对接表》退货登记（AirScript 服务端全表查）
  let returnMatches = [];
  if (!options.skipKdocs) {
    const outFile = projectPath("runtime", "review", `退货查询-${runStamp}.json`);
    const chunks = [];
    for (let index = 0; index < orderIds.length; index += 3) chunks.push(orderIds.slice(index, index + 3));
    const merged = { matches: [], batches: [] };
    for (const chunk of chunks) {
      const batchFile = projectPath("runtime", "review", `退货查询-${runStamp}-${chunk[0]}.json`);
      try {
        runNode(["src/tools/kdocs-query.js", ...chunk, "--out", path.relative(projectPath(), batchFile)], `金山《售后对接表》查 ${chunk.join("/")}`);
        const batch = JSON.parse(fs.readFileSync(batchFile, "utf8"));
        merged.matches.push(...(batch.matches || []));
        merged.batches.push({ chunk, hits: (batch.matches || []).length });
      } catch (error) {
        // 坑（2026-09-27）：kdocs-query 旧版用 process.exit(0)，Windows 下会触发 libuv 断言让退出码非 0，
        // 但产物文件其实已经写好。这里以产物文件为准（22号 经验：不能拿退出码当成功依据）。
        if (fs.existsSync(batchFile)) {
          try {
            const batch = JSON.parse(fs.readFileSync(batchFile, "utf8"));
            merged.matches.push(...(batch.matches || []));
            merged.batches.push({ chunk, hits: (batch.matches || []).length, note: "子进程退出码非0但产物已落盘" });
            continue;
          } catch (parseError) { /* 产物也不可读才算失败 */ }
        }
        console.log(`    ⚠ 这批查询失败：${error.message.split("\n")[0]}`);
        merged.batches.push({ chunk, error: error.message.split("\n")[0] });
      }
    }
    fs.writeFileSync(outFile, JSON.stringify(merged, null, 2), "utf8");
    returnMatches = merged.matches;
  }

  // 4.5) 京东仓退货表（用户 2026-09-27 口径）：货退到京东仓 = 安全，不用管。
  //   **对所有平台都查**（实测表里 453 行有 136 个天猫单——京东仓也给天猫发货，不只发京东单）。
  //   工具：src/tools/jd-warehouse-returns.js（导出明细 CSV → JSON，含「销售平台单号」）。
  //   默认自动刷新一次；失败则退用最新已有文件，并提醒。
  let warehouseMatches = [];
  if (!options.skipKdocs) {
    const dir = projectPath("runtime", "jd");
    const latestFile = () => {
      if (!fs.existsSync(dir)) return "";
      const files = fs.readdirSync(dir).filter((name) => name.startsWith("京东仓退货明细-") && name.endsWith(".json")).sort();
      return files.length ? path.join(dir, files[files.length - 1]) : "";
    };
    const freshFile = latestFile();
    const freshAge = freshFile ? Date.now() - fs.statSync(freshFile).mtimeMs : Infinity;
    if (!options.skipWarehouse && freshAge > 12 * 3600 * 1000) {
      try {
        runNode(["src/tools/jd-warehouse-returns.js"], "京东仓退货表（导出明细）");
      } catch (error) {
        console.log(`    ⚠ 京东仓退货表刷新失败（用已有文件兜底）：${error.message.split("\n")[0]}`);
      }
    }
    const file = latestFile();
    if (file) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const byOrder = new Map();
      for (const item of data.items || []) {
        const orderNo = String(item["销售平台单号"] || "").trim();
        if (!orderNo) continue;
        if (!byOrder.has(orderNo)) byOrder.set(orderNo, []);
        byOrder.get(orderNo).push(item);
      }
      for (const orderId of orderIds) {
        const hit = byOrder.get(orderId);
        if (hit) warehouseMatches.push({ orderId, rows: hit });
      }
      console.log(`  京东仓退货表：${path.basename(file)}（${(data.items || []).length} 行）→ 命中 ${warehouseMatches.length} 单`);
    } else {
      console.log("  ⚠ 还没有京东仓退货表（先跑 src/tools/jd-warehouse-returns.js，需京东物流登录态）");
    }
  }
  const warehouseHitOrders = new Set(warehouseMatches.map((m) => m.orderId));

  // 5) 判定
  const erpByCode = new Map((erp.orders || []).map((row) => [row.platformCode, row]));
  const tornByCode = new Map();
  for (const row of tornRows) {
    if (!tornByCode.has(row.code)) tornByCode.set(row.code, []);
    tornByCode.get(row.code).push(row);
  }
  // 归一化匹配：怀化表里订单号可能夹空格/零宽字符（用户 2026-09-27 指出），两边归一化再比。
  const returnHitCodes = new Set();
  for (const match of returnMatches) {
    for (const orderId of orderIds) {
      if (rowMatchesOrder(match.values, orderId)) returnHitCodes.add(orderId);
    }
  }

  const results = [];
  const appealsByOrder = new Map();
  for (const [store, value] of Object.entries(perStore)) {
    for (const item of value.items) {
      const orderId = platformConfig.extractOrders({ items: [item] })[0];
      if (!orderId) continue;
      if (!appealsByOrder.has(orderId)) appealsByOrder.set(orderId, []);
      appealsByOrder.get(orderId).push({ store, ...item });
    }
  }
  for (const orderId of orderIds) {
    const erpRow = erpByCode.get(orderId) || null;
    const torn = tornByCode.get(orderId) || [];
    const returned = returnHitCodes.has(orderId);
    const warehouseReturned = warehouseHitOrders.has(orderId);
    const category = classifyOrder({ erp: erpRow, torn, returned, warehouseReturned });
    results.push({ orderId, category, erp: erpRow, torn, returned, warehouseReturned, warehouseRows: warehouseMatches.filter((m) => m.orderId === orderId).flatMap((m) => m.rows), returnRows: returnMatches.filter((m) => rowMatchesOrder(m.values, orderId)), appeals: appealsByOrder.get(orderId) || [] });
  }

  // 5.5) 平台后台备注（只对「风险/待人工核」单）。
  // 经验（2026-09-27 用户指出）：**ERP 的卖家备注（sellerMemo）不更新，不能拿它判断处理进度**；
  //   真实进度看平台后台备注：拼多多 = 售后工作台 `mallRemark`（pdd-order-note.js），
  //   天猫 = 订单详情备注（tmall-order-note.js）。备注是自由文本，只抓原文写进报告，判读交模型。
  let noteRows = [];
  if (!options.skipNotes) {
    const noteTargets = results.filter((item) => /^风险|^待/.test(item.category));
    const byStore = new Map();
    for (const item of noteTargets) {
      const store = item.appeals[0]?.store || (stores.length === 1 ? stores[0] : "");
      if (!store) continue; // 没有店铺归属就不猜
      if (!byStore.has(store)) byStore.set(store, []);
      byStore.get(store).push(item.orderId);
    }
    const noteTool = { pdd: "src/tools/pdd-order-note.js", tmall: "src/tools/tmall-order-note.js", jd: "src/tools/jd-order-note.js" }[options.platform];
    if (!noteTool) { console.log("    （该平台还没有后台备注工具，跳过备注步骤）"); }
    for (const [store, ids] of (noteTool ? byStore : [])) {
      const outFile = projectPath("runtime", options.platform, `订单备注-${store}-${runStamp}.json`);
      try {
        runNode([noteTool, "--store", store, "--orders", ...ids, "--out", path.relative(projectPath(), outFile)], `${store} 平台后台备注（${ids.length} 单）`);
        const data = JSON.parse(fs.readFileSync(outFile, "utf8"));
        for (const row of data.rows || []) noteRows.push({ store, orderId: row.orderSn, found: row.found, noteText: row.mallRemark || "" });
        for (const row of data.results || []) noteRows.push({ store, orderId: row.orderId, found: row.ok, noteText: (row.notes || []).join(" ／ ") });
      } catch (error) {
        console.log(`    ⚠ ${store} 后台备注读取失败：${error.message.split("\n")[0]}`);
      }
    }
  }
  const noteByOrder = new Map(noteRows.map((row) => [row.orderId, row]));
  for (const item of results) item.platformNote = noteByOrder.get(item.orderId) || null;

  // 6) 报告
  const report = {
    generatedAt: new Date().toISOString(),
    platform: options.platform,
    stores,
    perStore: Object.fromEntries(Object.entries(perStore).map(([key, value]) => [key, { listFile: path.relative(projectPath(), value.listFile), items: value.items }])),
    orderCount: orderIds.length,
    summary: results.reduce((acc, item) => { acc[item.category] = (acc[item.category] || 0) + 1; return acc; }, {}),
    results
  };
  const jsonFile = options.out ? projectPath(options.out) : projectPath("runtime", "review", `复查报告-${options.platform}-${runStamp}.json`);
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), "utf8");

  const mdLines = [
    `# ${platformConfig.title} · 货物安全复查（${runStamp}）`,
    "",
    `订单 ${orderIds.length} 个 ｜ ${Object.entries(report.summary).map(([k, v]) => `${k} ${v}`).join(" ｜ ")}`,
    "",
    "| 订单编号 | 判定 | 店铺 | 申诉（类型/金额/剩余） | ERP状态 | 撕单表 | 退货登记 | 京东仓退货 | 后台备注（看这里，ERP备注不更新） |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const item of results) {
    const erpText = item.erp ? `${item.erp.cancelState}/${item.erp.approveState}/${item.erp.assignLabel}/${item.erp.deliveryLabel}` : "ERP无此单";
    const tornText = item.torn.length ? item.torn.map((t) => `${t.date}「${t.status}」`).join("<br>") : "-";
    const appealText = item.appeals.map((a) => platformConfig.appealText(a)).join("<br>") || "-";
    const noteText = item.platformNote ? (item.platformNote.noteText ? String(item.platformNote.noteText).replace(/\|/g, "／").replace(/\r?\n/g, " ") : "（空）") : "-";
    const warehouseText = item.warehouseReturned ? item.warehouseRows.map((row) => `${row["ECLP退货单号"]}｜${row["退货单状态"]}｜${row["逆向运单号"]}`).join("<br>") : (options.skipKdocs ? "-" : "无");
    mdLines.push(`| ${item.orderId} | **${item.category}** | ${item.erp ? item.erp.shopName : "-"} | ${appealText} | ${erpText} | ${tornText} | ${item.returned ? "已登记" : "无"} | ${warehouseText} | ${noteText} |`);
  }
  if (warehouseMatches.length) {
    mdLines.push("", "## 京东仓退货明细命中（证据）", "");
    for (const match of warehouseMatches) {
      for (const row of match.rows) {
        mdLines.push(`- ${match.orderId}：${row["ECLP退货单号"]}｜${row["退货单状态"]}｜${row["商品名称"] || ""}｜销售出库单号 ${row["销售出库单号"] || "-"}｜逆向运单 ${row["逆向运单号"] || "-"}`);
      }
    }
  }
  mdLines.push("", "## 平台后台备注原文（只对风险/待人工核单；ERP 备注不更新，以这里为准）", "");
  for (const row of noteRows) {
    mdLines.push(`- ${row.orderId}（${row.store}${row.found ? "" : "，后台查无此单"}）：${row.noteText || "（空）"}`);
  }
  mdLines.push("", "## 退货登记原始行（证据）", "");
  for (const match of returnMatches) {
    mdLines.push(`- 第 ${match.row} 行（${match.sheet}）：${(match.values || []).join(" ｜ ")}`);
  }
  const mdFile = projectPath("runtime", "review", `复查报告-${options.platform}-${runStamp}.md`);
  fs.writeFileSync(mdFile, mdLines.join("\n"), "utf8");

  console.log(`\n  ===== 复查汇总（${options.platform}）=====`);
  for (const [category, count] of Object.entries(report.summary)) console.log(`    ${category}：${count}`);
  for (const item of results) {
    if (/^风险|^待/.test(item.category)) {
      console.log(`    ⚠ ${item.orderId}（${item.erp ? item.erp.shopName : "ERP无此单"}）→ ${item.category}${item.erp ? ` ｜ ${item.erp.assignLabel}/${item.erp.deliveryLabel}` : ""} ｜ 后台备注：${item.platformNote ? (item.platformNote.noteText || "（空）") : "未读到"}`);
    }
  }
  console.log(`\n  报告：${path.relative(projectPath(), mdFile)}\n  数据：${path.relative(projectPath(), jsonFile)}\n`);
  return { report, mdFile, jsonFile };
}

module.exports = { runReview, PLATFORMS };
