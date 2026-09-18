#!/usr/bin/env node
// 读金山文档（只读）：列工作表 / 整片读取某个表 / 按关键字过滤行 / 导出矩阵 JSON。
// 匿名 + 无头，不需要 token，不动文档内容。
//
// 用法：
//   node src/tools/read-kdocs.js --url "https://www.kdocs.cn/l/ccj1mhG3wLy6" --list
//   node src/tools/read-kdocs.js --url "..." --sheet "退货退款表" --head 5
//   node src/tools/read-kdocs.js --url "..." --sheet "退货退款表" --grep "5127667812586099609"
//   node src/tools/read-kdocs.js --url "..." --sheet "退货退款表" --out runtime/kdocs/退货退款表.json
//   node src/tools/read-kdocs.js --url "..." --sheet "退货退款表" --headed      # 出问题时可见窗口排查
const fs = require("fs");
const path = require("path");
const { listSheets, readSheet } = require("../engine/kdocs");
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
