#!/usr/bin/env node
// 读金山文档（只读）：列工作表 / 整片读取某个表 / 按关键字过滤行 / 导出矩阵 JSON。
// 匿名 + 无头，不需要 token，不动文档内容。
//
// 用法：
//   node src/tools/read-kdocs.js --url "https://www.kdocs.cn/l/ccj1mhG3wLy6" --list
//   node src/tools/read-kdocs.js --url "..." --sheet "退货退款表" --head 5
//   node src/tools/read-kdocs.js --url "..." --sheet "退货退款表" --grep "5127667812586099609"
//   node src/tools/read-kdocs.js --url "..." --all --grep "5127667812586099609"     # 跨全部工作表搜（推荐）
//   node src/tools/read-kdocs.js --url "..." --all --out "runtime/kdocs/{sheet}.json"      # 全表导出
//   node src/tools/read-kdocs.js --url "..." --sheet "退货退款表" --headed      # 出问题时可见窗口排查
const fs = require("fs");
const path = require("path");
const { listSheets, readSheet, readSheets } = require("../engine/kdocs");
const { projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const DEFAULT_URL = "https://www.kdocs.cn/l/ccj1mhG3wLy6"; // 2026年【湖南怀化售后】对接表

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, headless: true, head: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "list") { args.list = true; continue; }
    if (key === "headed") { args.headless = false; continue; }
    if (key === "all") { args.all = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "url") args.url = value;
    else if (key === "sheet") args.sheet = value;
    else if (key === "grep") args.grep = value;
    else if (key === "head") args.head = Number(value);
    else if (key === "out") args.out = value;
  }
  return args;
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // 富文本/超链接单元格会返回对象，取常见字段
    return String(value.Text || value.text || value.RichText || value.Value2 || JSON.stringify(value)).replace(/\s+/g, " ").trim();
  }
  return String(value).replace(/\s+/g, " ").trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  log("金山", "读取", args.list ? "列工作表" : `工作表「${args.sheet || "?"}」`, args.url);

  if (args.list) {
    const names = await listSheets(args.url, { headless: args.headless });
    console.log(`\n  工作表（${names.length} 个）：`);
    for (const name of names) console.log(`    · ${name}`);
    console.log("");
    process.exit(0);
  }

  // --all：一次会话读全部工作表，并（可选）跨表搜关键字——WPS 自带搜索是跨表的，
  // 只查一个工作表会漏（2026-09-18 实例：订单 5127667812586099609 不在退货退款表，但用户能搜到）。
  if (args.all) {
    const names = args.sheet ? [args.sheet] : await listSheets(args.url, { headless: args.headless });
    log("金山", "全表读取", `${names.length} 个工作表`);
    const all = await readSheets(args.url, names, { headless: args.headless });
    const summary = [];
    for (const name of names) {
      const item = all[name] || {};
      const matrix = (item.matrix || []).map((row) => (Array.isArray(row) ? row.map(cellText) : []));
      summary.push({ sheet: name, rowCount: item.rowCount ?? 0, columnCount: item.columnCount ?? 0, error: item.error || "" });
      if (args.out) {
        const outPath = projectPath(args.out.replace("{sheet}", name));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify({ sheetName: name, matrix }, null, 2), "utf8");
      }
      if (args.grep) {
        const hits = [];
        matrix.forEach((row, index) => {
          const raw = row.join(" ");
          if (raw.includes(args.grep)) hits.push({ rowNumber: index + 1, raw });
        });
        if (hits.length) {
          console.log(`\n  ★ 工作表「${name}」命中 ${hits.length} 行：`);
          for (const hit of hits.slice(0, 8)) console.log(`    第 ${hit.rowNumber} 行：${hit.raw.slice(0, 260)}`);
        }
      }
    }
    console.log("\n  各表规模：");
    for (const item of summary) console.log(`    · ${item.sheet}：${item.rowCount} 行 × ${item.columnCount} 列${item.error ? `（${item.error}）` : ""}`);
    if (args.grep) {
      const total = summary.reduce((sum, item) => sum + item.rowCount, 0);
      console.log(`\n  已跨 ${summary.length} 个表（共 ${total} 行）搜「${args.grep}」完毕。`);
    }
    console.log("");
    process.exit(0);
  }
  if (!args.sheet) {
    console.error("请用 --sheet 指定工作表名（先用 --list 看有哪些）。");
    process.exit(2);
  }

  const result = await readSheet(args.url, args.sheet, { headless: args.headless });
  const matrix = result.matrix.map((row) => (Array.isArray(row) ? row.map(cellText) : []));
  log("金山", "读取成功", `${result.sheetName}：${result.rowCount} 行 × ${result.columnCount} 列`);

  if (args.out) {
    const outPath = path.isAbsolute(args.out) ? args.out : projectPath(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ sheetName: result.sheetName, sheetNames: result.sheetNames, matrix }, null, 2), "utf8");
    console.log(`\n  已导出：${path.relative(projectPath(), outPath)}`);
  }

  // 表头：取第一片非空行（很多表开头有空行）
  const headerIndex = matrix.findIndex((row) => row.filter(Boolean).length >= 2);
  console.log(`\n  表头（第 ${headerIndex + 1} 行）：${matrix[headerIndex] ? matrix[headerIndex].join(" | ").slice(0, 400) : "(空)"}`);
  console.log(`  前 ${args.head} 行数据：`);
  for (const row of matrix.slice(headerIndex + 1, headerIndex + 1 + args.head)) {
    const text = row.filter(Boolean).join(" | ");
    if (text) console.log(`    · ${text.slice(0, 220)}`);
  }

  if (args.grep) {
    const hits = [];
    matrix.forEach((row, index) => {
      if (row.some((cell) => cell.includes(args.grep))) hits.push({ rowNumber: index + 1, row });
    });
    console.log(`\n  含「${args.grep}」的行：${hits.length} 行`);
    for (const hit of hits.slice(0, 10)) console.log(`    · 第 ${hit.rowNumber} 行：${hit.row.filter(Boolean).join(" | ").slice(0, 240)}`);
  }
  console.log("");
  process.exit(0);
}

main().catch((error) => {
  log("金山", "失败", error.stack || error.message);
  console.error(`\n  读取失败：${error.message}\n`);
  process.exit(1);
});
