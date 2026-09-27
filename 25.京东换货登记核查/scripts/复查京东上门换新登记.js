#!/usr/bin/env node
// 25号 京东【上门换新取件】登记核查（只读）—— 用户 2026-09-27 任务：
//   京东上门换新 = 京东仓直接给客户换出新机（平台订单实付 ¥0），但客户的故障机还要寄回我们工厂；
//   客服必须在金山《2026年【湖南怀化售后】对接表》→「换货维修登记表」登记一条，工厂才知道机器是谁寄回的。
//   **登记规范：所有选项选「无需处理」+ 客户地址别填**（填了地址，工厂可能又寄一台 → 重复换货、白亏一台）。
//
// 检查口径：
//   ① 京东侧：src/tools/jd-exchange-list.js 取「客户期望=换货 + 售后状态=完成 + pickWareTypeName=上门换新取件」，最近 30 天
//   ② 金山侧：按订单号（归一化）在「换货维修登记表」找行（AirScript 只读全表查）
//   ③ 判定：没登记 = ⚠风险；登记了但 **地址列(第 11 列/index 10)非空** 或
//      **质保标准/客户寄给厂家的运费/厂家寄给客户的运费(index 17/18/19) 有一个不是「无需处理」** = ⚠风险
//
// 为什么按列号判：金山老脚本只返回非空单元格（**列位置会丢**），判不了「地址列是不是空的」；
//   新版脚本（2026-09-27.2+）每行多返回 `cells: [{c: 列号, v: 文字}]`，才能精确定位。
//
// 用法：
//   node scripts/复查京东上门换新登记.js                 # 全部店（读各店最新清单）
//   node scripts/复查京东上门换新登记.js --days 90 --stores jd1,jd3
//   node scripts/复查京东上门换新登记.js --list-file runtime/jd/上门换新取件清单-jd1-xxx.json
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { projectPath } = require("../src/config/stores");
const { normalizeOrderNo } = require("../src/features/review/orderNoMatch");
const { log } = require("../src/engine/log");
const { runAirScript } = require("../src/engine/kdocsAirScript");
const { judgeOrder, OPTION_COLUMNS, ADDRESS_COLUMN } = require("../src/features/exchange/registrationCheck");

const SHEET = "换货维修登记表";
// 列号与 src/features/exchange/registrationCheck.js 保持一致（判定的唯一出处在那里）
const COLUMN = { 地址: ADDRESS_COLUMN.index, 订单号: 13, 处理方式: 16, 质保标准: OPTION_COLUMNS[0].index, 客户寄给厂家的运费: OPTION_COLUMNS[1].index, 厂家寄给客户的运费: OPTION_COLUMNS[2].index, 处理客服: 22, 备注: 23 };
const NO_ACTION = "无需处理";
const KEYWORD_BATCH = 10;   // 金山批量关键词实测：10 个/批稳，20 个/批 403

function parseArgs(argv) {
  const args = { stores: "jd1,jd2,jd3,jd6,jd8", days: 90 };   // 默认 3 个月（用户 2026-09-27 拍板）
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const value = argv[index + 1];
    index += 1;
    if (token === "--stores") args.stores = value;
    else if (token === "--days") args.days = Number(value);
    else if (token === "--list-file") args.listFile = value;
    else if (token === "--out") args.out = value;
  }
  return args;
}

function stamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function latestListFiles(stores) {
  const dir = projectPath("runtime", "jd");
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const store of stores) {
    const hits = fs.readdirSync(dir).filter((name) => name.startsWith(`上门换新取件清单-${store}-`) && name.endsWith(".json")).sort();
    if (hits.length) files.push(path.join(dir, hits[hits.length - 1]));
  }
  return files;
}

// 金山查询：按订单号批量查「换货维修登记表」，返回 { orderKey -> row }
function queryRows(orderIds) {
  const byOrder = new Map();
  const chunks = [];
  for (let index = 0; index < orderIds.length; index += KEYWORD_BATCH) chunks.push(orderIds.slice(index, index + KEYWORD_BATCH));
  const scriptVersions = new Set();
  for (const chunk of chunks) {
    const result = runAirScriptSync(chunk);
    if (result.scriptVersion) scriptVersions.add(result.scriptVersion);
    for (const match of result.matches || []) {
      // cells（新版）优先：带列号；老版只有 values（非空值，列位置丢失）
      const cells = match.cells || [];
      const values = match.values || [];
      const text = values.join("\n");
      const matched = chunk.find((orderId) => text.includes(orderId)) || "";
      const key = normalizeOrderNo(matched);
      if (!key) continue;
      if (!byOrder.has(key)) byOrder.set(key, []);
      byOrder.get(key).push({ sheet: match.sheet, row: match.row, cells, values });
    }
  }
  return { byOrder, scriptVersions: [...scriptVersions] };
}

// 用哪个金山脚本：25号 专用的「只读查行带列号」（能拿到列号）优先；
//   没配就退回 22号/24号 那份「只读查询订单号」（只有非空值，判不了地址列 → 报告会标粗判）。
function scriptName() {
  try {
    const config = JSON.parse(fs.readFileSync(projectPath("project-config", "kdocs-airscript.json"), "utf8"));
    const entry = config.scripts && config.scripts.rowQuery;
    if (entry && entry.webhookUrl) return "rowQuery";
  } catch (error) { /* 配置读不到就退回老脚本 */ }
  return "query";
}

function runAirScriptSync(keywords) {
  // AirScript 是异步的；这里用子进程同步跑，保持脚本主线是同步风格（与 24号 一致）
  const enginePath = projectPath("src", "engine", "kdocsAirScript.js");
  const code = [
    `const { runAirScript } = require(${JSON.stringify(enginePath)});`,
    `runAirScript({ keywords: ${JSON.stringify(keywords)}, sheet: ${JSON.stringify(SHEET)}, maxRows: 50000 }, { script: ${JSON.stringify(scriptName())} })`,
    "  .then((r) => { process.stdout.write(JSON.stringify(r)); })",
    "  .catch((e) => { process.stderr.write(String(e.message)); process.exitCode = 1; });"
  ].join(String.fromCharCode(10));
  const out = execFileSync(process.execPath, ["-e", code], { cwd: projectPath(), encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(out);
}

// 从一行里取某一列：有 cells 用列号精确定位；否则退化为「有没有地址样的文本」的粗略判断
function cellOf(row, columnIndex) {
  if (Array.isArray(row.cells) && row.cells.length) {
    const hit = row.cells.find((item) => Number(item.c) === columnIndex);
    return hit ? String(hit.v || "").trim() : "";
  }
  return null;   // 老版脚本拿不到
}

// 老版脚本兜底：行里有没有「地址样」文本。**必须先剔掉订单号/客户ID**——16 位订单号里含 11 位连续数字，
// 不剔会把正常行全判成「有地址」（2026-09-27 实测踩过）。
function looksLikeAddress(values, orderId) {
  const key = normalizeOrderNo(orderId);
  return values.some((text) => {
    const value = String(text || "");
    if (key && normalizeOrderNo(value).includes(key)) return false;
    if (/^(jd_|tb\d|微信|wxid)/i.test(value)) return false;   // 客户 ID 列
    if (/^\d{4,6}$/.test(value.trim())) return false;          // 日期序列号 / 数量
    return /(\d{11}|收货人|联系方式|省|市|区|县)/.test(value);
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runStamp = stamp();
  const stores = args.stores.split(",").map((s) => s.trim()).filter(Boolean);
  const files = args.listFile ? [projectPath(args.listFile)] : latestListFiles(stores);
  if (!files.length) throw new Error("没有清单文件——先跑 src/tools/jd-exchange-list.js --store jd1");

  const items = [];
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const item of data.items || []) items.push({ store: data.store, listFile: path.basename(file), ...item });
  }
  console.log(`  清单：${files.length} 个文件，共 ${items.length} 单（${items.map((i) => i.store).join("/")}）`);
  if (!items.length) { console.log("  没有「上门换新取件」单，结束。"); return; }

  const orderIds = [...new Set(items.map((item) => item.orderId).filter(Boolean))];
  const { byOrder, scriptVersions } = queryRows(orderIds);
  console.log(`  金山查询：${orderIds.length} 个订单号｜脚本版本 ${scriptVersions.join("/")}｜命中 ${byOrder.size} 个订单`);

  const withCells = [...byOrder.values()].flat().some((row) => Array.isArray(row.cells) && row.cells.length);
  if (!withCells) console.log("  ⚠ 金山脚本还是老版（只返回非空值，列位置丢失）→ 地址/选项只能粗略判；建议让用户重贴 2026-09-27.2");

  const results = [];
  for (const item of items) {
    const key = normalizeOrderNo(item.orderId);
    const rows = byOrder.get(key) || [];
    const checks = rows.map((row) => {
      const address = cellOf(row, COLUMN.地址);
      const opts = [COLUMN.质保标准, COLUMN.客户寄给厂家的运费, COLUMN.厂家寄给客户的运费].map((index) => cellOf(row, index));
      const handler = cellOf(row, COLUMN.处理方式);
      return {
        row: row.row,
        地址: address,
        选项: opts,
        处理方式: handler,
        客服: cellOf(row, COLUMN.处理客服),
        备注: cellOf(row, COLUMN.备注),
        原始值: row.values
      };
    });
    // 判定统一走被测过的纯函数（见 src/features/exchange/registrationCheck.js + tests/exchangeRegistration.test.js）
    const judged = judgeOrder(rows);
    let verdict = judged.verdict;
    let problems = judged.problems.slice();
    if (verdict === "coarse") {
      // 老版金山脚本拿不到列号 → 粗判（有地址样文本才算有问题），并在报告里标出来
      verdict = "ok";
      for (const check of checks) {
        if (looksLikeAddress(check.原始值, item.orderId)) { problems.push("（粗判）行里出现疑似地址/电话文本"); verdict = "risk"; }
      }
    }
    results.push({ ...item, registered: rows.length > 0, checks, verdict, problems });
  }

  const summary = {
    总单数: results.length,
    已规范登记: results.filter((r) => r.verdict === "ok").length,
    未登记: results.filter((r) => r.verdict === "missing").length,
    登记有问题: results.filter((r) => r.verdict === "risk").length,
    待核_选项填了别的值: results.filter((r) => r.verdict === "warn").length
  };
  const report = { generatedAt: new Date().toISOString(), scriptVersions, columnMap: COLUMN, summary, results };
  const jsonFile = projectPath("runtime", "review", `复查报告-上门换新登记-${runStamp}.json`);
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), "utf8");

  const lines = [
    `# 京东「上门换新取件」登记核查（${runStamp}）`,
    "",
    `检查范围：客户期望=换货 + 售后状态=完成 → pickWareTypeName=「上门换新取件」→ 最近 ${args.days} 天`,
    "",
    `**共 ${summary.总单数} 单 ｜ ✅ 已规范登记 ${summary.已规范登记} ｜ ⚠ 未登记 ${summary.未登记} ｜ ⚠ 有风险 ${summary.登记有问题} ｜ 🟡 待核 ${summary.待核_选项填了别的值}**`,
    "",
    "口径（用户 2026-09-27 拍板）：**要防的是工厂重复换货 → 填多了才有问题，空着没事**。",
    "- ✅ 规范 = **地址列空** + 三个选项列**空或「无需处理」**；",
    "- ⚠ 有风险 = 地址列填了内容（工厂可能照着又寄一台）；",
    "- 🟡 待核 = 三个选项列填了「无需处理」以外的值（原文列在下面，人/模型看是不是给工厂布置了动作）；",
    "- ⚠ 未登记 = 金山表里根本没有这单（工厂不知道机器是谁寄回的）。",
    "",
    "| 订单号 | 店铺 | 售后单 | 申请日期 | 登记行 | 地址列 | 质保 | 运费1 | 运费2 | 判定 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const item of results) {
    const check = item.checks[0] || {};
    const mark = item.verdict === "ok" ? "✅ 规范"
      : (item.verdict === "missing" ? "⚠ 未登记"
        : (item.verdict === "risk" ? "⚠ 有风险" : "🟡 待核"));
    lines.push(`| ${item.orderId} | ${item.store} | ${item.serviceOrderId} | ${(item.applyTime || "").slice(0, 10)} | ${check.row || "-"} | ${check.地址 === null ? "(无列号)" : (check.地址 || "(空)")} | ${(check.选项 || [])[0] || "-"} | ${(check.选项 || [])[1] || "-"} | ${(check.选项 || [])[2] || "-"} | ${mark} |`);
  }
  if (summary.未登记 || summary.登记有问题 || summary.待核_选项填了别的值) {
    lines.push("", "## 需要看的单（异常 + 待核）", "");
    for (const item of results.filter((r) => r.verdict !== "ok")) {
      lines.push(`- ${item.orderId}（${item.store}，申请 ${(item.applyTime || "").slice(0, 10)}）：${item.problems.join("；") || "（见下面原始行）"}`);
      for (const check of item.checks) {
        lines.push(`  - 登记行 ${check.row}：地址=${check.地址 === null ? "(无列号)" : (check.地址 || "(空)")}｜三项=${(check.选项 || []).map((v) => (v === null ? "(无列号)" : (v || "(空)"))).join(" / ")}｜处理方式=${check.处理方式 || "(空)"}｜客服=${check.客服 || "(空)"}｜备注=${check.备注 || "(空)"}`);
      }
    }
  }
  const mdFile = projectPath("runtime", "review", `复查报告-上门换新登记-${runStamp}.md`);
  fs.writeFileSync(mdFile, lines.join("\n"), "utf8");

  log("上门换新登记核查", "完成", `总 ${summary.总单数}｜规范 ${summary.已规范登记}｜未登记 ${summary.未登记}｜有风险 ${summary.登记有问题}｜待核 ${summary.待核_选项填了别的值}`, path.relative(projectPath(), mdFile));
  console.log(`\n  ===== 京东「上门换新取件」登记核查 =====`);
  console.log(`    共 ${summary.总单数} 单 ｜ ✅ 规范 ${summary.已规范登记} ｜ ⚠ 未登记 ${summary.未登记} ｜ ⚠ 有风险 ${summary.登记有问题} ｜ 🟡 待核 ${summary.待核_选项填了别的值}`);
  console.log(`\n  报告：${path.relative(projectPath(), mdFile)}\n`);
  return report;
}

main();
