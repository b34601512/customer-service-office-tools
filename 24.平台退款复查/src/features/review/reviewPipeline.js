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
    runNode(["src/tools/read-kdocs.js", "--url", "https://www.kdocs.cn/l/csvonDeJ0BE2", "--sheet", "撕单表", "--out", path.relative(projectPath(), tornFile)], "金山《撕单表》只读");
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

  // 5) 判定
  const erpByCode = new Map((erp.orders || []).map((row) => [row.platformCode, row]));
  const tornByCode = new Map();
  for (const row of tornRows) {
    if (!tornByCode.has(row.code)) tornByCode.set(row.code, []);
    tornByCode.get(row.code).push(row);
  }
  const returnHitCodes = new Set();
  for (const match of returnMatches) {
    for (const value of match.values || []) {
      if (orderIds.includes(String(value).trim())) returnHitCodes.add(String(value).trim());
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
    const category = classifyOrder({ erp: erpRow, torn, returned });
    results.push({ orderId, category, erp: erpRow, torn, returned, returnRows: returnMatches.filter((m) => (m.values || []).includes(orderId)), appeals: appealsByOrder.get(orderId) || [] });
  }

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
    "| 订单编号 | 判定 | 店铺 | 申诉（类型/金额/剩余） | ERP状态 | 撕单表 | 退货登记 |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const item of results) {
    const erpText = item.erp ? `${item.erp.cancelState}/${item.erp.approveState}/${item.erp.assignLabel}/${item.erp.deliveryLabel}` : "ERP无此单";
    const tornText = item.torn.length ? item.torn.map((t) => `${t.date}「${t.status}」`).join("<br>") : "-";
    const appealText = item.appeals.map((a) => platformConfig.appealText(a)).join("<br>") || "-";
    mdLines.push(`| ${item.orderId} | **${item.category}** | ${item.erp ? item.erp.shopName : "-"} | ${appealText} | ${erpText} | ${tornText} | ${item.returned ? "已登记" : "无"} |`);
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
      console.log(`    ⚠ ${item.orderId}（${item.erp ? item.erp.shopName : "ERP无此单"}）→ ${item.category}${item.erp ? ` ｜ ${item.erp.assignLabel}/${item.erp.deliveryLabel}` : ""}`);
    }
  }
  console.log(`\n  报告：${path.relative(projectPath(), mdFile)}\n  数据：${path.relative(projectPath(), jsonFile)}\n`);
  return { report, mdFile, jsonFile };
}

module.exports = { runReview, PLATFORMS };
