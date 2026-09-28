#!/usr/bin/env node
// 7号：查「这个订单号客服登记过没有」——走金山 AirScript 云端读全表（不受网页版「只加载当前窗口」限制）。
// 依赖：project-config/kdocs-airscript.json（{"scripts":{"query":{"webhookUrl":"..."}}}，令牌可回退读 12号，均不入库）；
//      脚本正文 kdocs-scripts/AirScript-只读查询订单号.md（用户在文档里粘一次、保存、生成同步 webhook）。
//
// 用法：
//   node scripts/查登记表.js 260903-171347832413939            # 查订单号（默认只查登记子表）
//   node scripts/查登记表.js --尾部                            # 只诊断：行数 / 最后一行 / 各年条数 / 最后几行
//   node scripts/查登记表.js 260903-171347832413939 --全部表     # 全部工作表都扫（慢）
//   node scripts/查登记表.js --行 2751                      # 按行号读（带列字母，核对字段/看填写样式）
//   node scripts/查登记表.js --行 2740-2760
//   node scripts/查登记表.js 260903-171347832413939 --out project-config/查重-260903.json
const fs = require("fs");
const path = require("path");
const { 跑脚本 } = require("../src/金山脚本客户端");

const 项目根 = path.resolve(__dirname, "..");

function 解析参数(argv) {
  const 结果 = { 关键词: [], 最大行: 20000, 尾部: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--sheets") { 结果.sheets = String(argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean); i += 1; continue; }
    if (词 === "--全部表") { 结果.全部表 = true; continue; }
    if (词 === "--尾部") { 结果.只诊断 = true; if (/^\d+$/.test(String(argv[i + 1] || ""))) { 结果.尾部 = Number(argv[i + 1]); i += 1; } continue; }
    if (词 === "--行") {
      const 范围 = String(argv[i + 1] || "").split("-");
      结果.rowFrom = Number(范围[0]);
      结果.rowTo = Number(范围[1] || 范围[0]);
      i += 1;
      continue;
    }
    if (词 === "--out") { 结果.out = argv[i + 1]; i += 1; continue; }
    if (词 === "--最大行") { 结果.最大行 = Number(argv[i + 1]); i += 1; continue; }
    if (词.startsWith("--")) continue;
    结果.关键词.push(词);
  }
  return 结果;
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (!参数.关键词.length && !参数.只诊断 && !参数.rowFrom) {
    console.error('用法：node scripts/查登记表.js <订单号...> | --尾部 [N] | --行 2751 [--行 2740-2760] [--全部表] [--sheets "表1,表2"] [--out 文件]');
    process.exit(2);
  }
  const 请求 = { keywords: 参数.关键词, maxRows: 参数.最大行, tailRows: 参数.尾部 };
  if (参数.rowFrom) { 请求.rowFrom = 参数.rowFrom; 请求.rowTo = 参数.rowTo; }
  if (参数.sheets) 请求.sheets = 参数.sheets;
  if (参数.全部表) 请求.allSheets = true;

  const 结果 = await 跑脚本(请求);   // 直接传对象：传数组时金山会转成类数组对象，脚本里取不到 keywords（2026-09-28 实测）
  console.log(`\n  脚本版本 ${结果.scriptVersion} | 扫描 ${结果.checkedSheets} 个表 / ${结果.scannedRows} 行`);
  for (const 表 of 结果.sheetDetails || []) {
    const 年份 = 表.yearCounts ? Object.keys(表.yearCounts).sort().map((y) => `${y} 年 ${表.yearCounts[y]} 条`).join("、") : "";
    console.log(`    · ${表.sheet}：读到 ${表.rows} 行；有数据最后一行 = 第 ${表.lastRow} 行（登记日期 ${表.lastRowDate || "空"}）${年份 ? `；各年条数：${年份}` : ""}${表.error ? ` ⚠ ${表.error}` : ""}`);
  }
  console.log(`\n  命中合计：${结果.matchCount} 行`);
  for (const 命中 of 结果.matches || []) {
    console.log(`    【${命中.sheet} 第 ${命中.row} 行】${命中.values.join(" | ").slice(0, 240)}`);
  }
  if (结果.tail && 结果.tail.length) {
    console.log("\n  最后几行（看填写样式）：");
    for (const 行 of 结果.tail) console.log(`    第 ${行.row} 行：${行.values.join(" | ").slice(0, 240)}`);
  }
  if (结果.dump && 结果.dump.length) {
    console.log(`\n  按行读出 ${结果.dump.length} 行（列字母=值）：`);
    for (const 行 of 结果.dump) console.log(`    第 ${行.row} 行：${行.values.join(" | ").slice(0, 400)}`);
  }
  if (参数.out) {
    const 输出路径 = path.isAbsolute(参数.out) ? 参数.out : path.join(项目根, 参数.out);
    fs.mkdirSync(path.dirname(输出路径), { recursive: true });
    fs.writeFileSync(输出路径, JSON.stringify(结果, null, 2), "utf8");
    console.log(`\n  已保存：${path.relative(项目根, 输出路径)}`);
  }
  console.log("");
}

main().catch((错误) => {
  console.error(`\n  查询失败：${错误.message}\n`);
  process.exit(1);
});
