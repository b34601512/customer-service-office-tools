// 金山只读查询命令行：用文档里已保存的「只读查询」AirScript 查订单号/关键字（服务端读全表，不受网页窗口加载限制）。
//
// ⚠ 2026-09-30 收拢：**唯一出处**。22/24/25 号原来各有一份 `src/tools/kdocs-query.js`，
//    现在项目的那个文件只是薄壳（传 项目根 + log + runAirScript）。
//    注意：22号 原来那份用的是 `process.exit(0/1)`——2026-09-27 已确认它在 Node 24 + Windows 会触发
//    libuv 断言 "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"，让上游误判「查询失败」（产物其实已落盘）；
//    收拢时统一按修好的写法（`process.exitCode`，自然退出）。
//
// 依赖：project-config/kdocs-airscript.json（{"webhookUrl":"...","apiToken":"..."}，不入库）；
//      脚本正文见 kdocs-scripts/AirScript-只读查询订单号.txt（在文档里粘一次、保存、生成 token）。
//
// 用法（在项目里）：
//   node src/tools/kdocs-query.js 5127667812586099609
//   node src/tools/kdocs-query.js 5127667812586099609 3316423947070006870
//   node src/tools/kdocs-query.js 5127667812586099609 --sheets "退货退款表,异常件"
//   node src/tools/kdocs-query.js 5127667812586099609 --out runtime/kdocs/query-<关键词>.json
const fs = require("fs");
const path = require("path");

// 2026-11-11：默认 maxRows 5 万 → 10 万（湖南《退货退款表》已到 50088 行，5 万会静默漏掉后面的退回记录）。
// 同时加护栏：扫到上限还没到底就抛错，不拿半张表下结论。
function parseArgs(argv) {
  const args = { keywords: [], maxRows: 100000, batchSize: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--sheets") { args.sheets = String(argv[index + 1] || "").split(",").map((name) => name.trim()).filter(Boolean); index += 1; continue; }
    if (token === "--out") { args.out = argv[index + 1]; index += 1; continue; }
    if (token === "--max-rows") { args.maxRows = Number(argv[index + 1]); index += 1; continue; }
    if (token === "--batch-size") { args.batchSize = Number(argv[index + 1]); index += 1; continue; }
    if (token.startsWith("--")) continue;
    args.keywords.push(token);
  }
  return args;
}

// 扫到上限仍没到底 = 不能证明扫完了。抛错，不静默截断（2026-11-11 木婉清报：50000 行把 2237/2238 判成「未退回」）。
// 返回最深扫到第几行（sheetDetails[].rows 是「扫到的末行」，不是行数）。
function 最深处(结果) {
  let 最深 = 0;
  for (const item of (结果 && 结果.sheetDetails) || []) 最深 = Math.max(最深, Number(item.rows) || 0);
  return 最深;
}

function 检查截断(结果, maxRows) {
  const 上限 = Number(maxRows);
  if (!Number.isFinite(上限) || 上限 < 1) throw new Error(`--max-rows 必须是正数（收到 ${maxRows}）`);
  const 到顶 = ((结果 && 结果.sheetDetails) || []).filter((item) => Number(item.rows) >= 上限);
  if (到顶.length) {
    const 明细 = 到顶.map((item) => `${item.sheet || "（未知表）"} 扫到第 ${item.rows} 行`).join("；");
    throw new Error(`扫描到上限 ${上限} 行还没到底（${明细}）——表可能还有数据，不能拿半张表下结论。请把 --max-rows 调大（如 ${上限 * 2}）再查。`);
  }
  return 最深处(结果);
}

// 金山脚本有执行时长上限（实测 ~30 秒后接口返回 HTTP 500），关键词越多匹配越慢，
// 所以关键词多于一批的量时自动拆批调用，再把结果合并。
function splitBatches(keywords, batchSize) {
  const batches = [];
  for (let index = 0; index < keywords.length; index += batchSize) {
    batches.push(keywords.slice(index, index + batchSize));
  }
  return batches;
}

/** 跑查询命令行：调用方注入 项目根 / log / runAirScript（各项目薄壳）。返回 { exitCode } */
async function 跑查询命令行({ argv = [], 项目根 = process.cwd(), log = () => {}, runAirScript } = {}) {
  if (!runAirScript) throw new Error("跑查询命令行需要传 runAirScript（创建脚本客户端 的返回值里的那个）");
  const args = parseArgs(argv);
  if (!args.keywords.length) {
    console.error("用法：node src/tools/kdocs-query.js <订单号> [更多订单号...] [--sheets \"退货退款表,异常件\"] [--out 文件]");
    return { exitCode: 2 };
  }
  const batches = splitBatches(args.keywords, args.batchSize);
  log("金山查询", "开始", `关键词 ${args.keywords.length} 个（分 ${batches.length} 批）`, args.sheets ? `表：${args.sheets.join("/")}` : "全部工作表");

  const merged = { scriptVersion: "", keywords: [], checkedSheets: 0, scannedRows: 0, sheetDetails: [], matches: [], batches: batches.length };
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const result = await runAirScript({ keywords: batches[batchIndex], maxRows: args.maxRows, sheets: args.sheets });
    log("金山查询", "批次完成", `第 ${batchIndex + 1}/${batches.length} 批（${batches[batchIndex].length} 个词）`, `命中 ${result.matchCount} 行`);
    merged.scriptVersion = result.scriptVersion || merged.scriptVersion;
    merged.keywords = merged.keywords.concat(result.keywords || []);
    merged.checkedSheets = result.checkedSheets || merged.checkedSheets;
    merged.scannedRows += result.scannedRows || 0;
    merged.sheetDetails = merged.sheetDetails.concat(result.sheetDetails || []);
    for (const match of result.matches || []) {
      const key = `${match.sheet}#${match.row}`;
      if (!merged.matches.some((item) => `${item.sheet}#${item.row}` === key)) merged.matches.push(match);
    }
    if (batchIndex + 1 < batches.length) await new Promise((resolve) => setTimeout(resolve, 800));
  }
  merged.matchCount = merged.matches.length;
  // 护栏放在落盘/打印之前：截断时不产出任何「结论」文件。
  merged.扫描到行 = 检查截断(merged, args.maxRows);
  const result = merged;   // 下面的打印逻辑按合并后的结果走
  log("金山查询", "完成", `扫到第 ${result.扫描到行} 行 / ${result.checkedSheets} 个表，命中 ${result.matchCount} 行`);

  // scannedRows 是各批相加（同一张表扫几批就乘几），不能当「表有多长」；表长看扫到第几行。
  console.log(`\n  扫描：${result.checkedSheets} 个工作表 / 扫到第 ${result.扫描到行} 行（${result.batches} 批，各批合计 ${result.scannedRows} 行）`);
  console.log("  各表命中：");
  for (const item of result.sheetDetails || []) {
    if (item.hits) console.log(`    · ${item.sheet}：${item.hits} 行（扫 ${item.rows} 行）`);
  }
  console.log(`\n  命中合计：${result.matchCount} 行`);
  for (const match of result.matches || []) {
    console.log(`    【${match.sheet} 第 ${match.row} 行】${match.values.join(" | ").slice(0, 220)}`);
  }
  if (args.out) {
    const outPath = path.resolve(项目根, args.out.replace("<关键词>", args.keywords[0]));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
    console.log(`\n  已保存：${path.relative(项目根, outPath)}`);
  }
  console.log("");
  return { exitCode: 0 };
}

module.exports = { 跑查询命令行, parseArgs, splitBatches, 检查截断, 最深处 };
