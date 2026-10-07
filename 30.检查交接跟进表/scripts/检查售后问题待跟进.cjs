#!/usr/bin/env node
// 30号：只读检查《2026年【交接&跟进】表》『售后问题待跟进』子表 → 未完结清单（口令「检查交接跟进表」）。
//
// 口径（立项 2026-10-07）：
//   · 只看**真实数据行**（登记时间或 ID/订单编号 非空）——底部 7000+ 行是只带 ☐ 的模板行，不算；
//   · 「是否已完结」不是已完结标记（☑/是/TRUE）的行 = **未完结**；
//   · 五个匹配列（湖南｜京东仓｜撕单｜理赔｜异常件表）值 #N/A/空 = 该渠道没匹配到；
//     五个全无匹配 = 还没在任何渠道找到退货/理赔线索，要重点跟。
//
// 用法：
//   node scripts/检查售后问题待跟进.cjs [--json [路径]]
//   · 默认打印统计 + 未完结清单；--json 时额外落盘（默认 runtime/售后问题待跟进-未完结-<时间戳>.json）。
//   · 只读（24号 read-kdocs，匿名无头），不动表；失败不自动重试。
const fs = require("node:fs");
const path = require("node:path");
const { 读工作表, 项目根, 仓库根 } = require("./金山只读.cjs");

const 子表 = "售后问题待跟进";
const 已完结标记 = ["☑", "✓", "√", "是", "TRUE", "true", "Y", "y"];
const 无匹配标记 = ["", "#N/A", "N/A", "#REF!", "#VALUE!", "#NAME?"];

function 取文本(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return String(v.Text || v.text || v.RichText || v.Value2 || JSON.stringify(v)).trim();
  return String(v).trim();
}

function 找列(表头, 候选) {
  for (const 名 of 候选) {
    const i = 表头.indexOf(名);
    if (i > -1) return i;
  }
  return -1;
}

function 是已完结(值) {
  return 已完结标记.includes(取文本(值));
}

function 是无匹配(值) {
  return 无匹配标记.includes(取文本(值).toUpperCase());
}

function 解析参数(argv) {
  const 参数 = { json: false, jsonPath: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--json") 参数.json = true;
    else if (argv[i] === "--json-path") { 参数.json = true; 参数.jsonPath = argv[i + 1] || ""; i += 1; }
  }
  return 参数;
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  console.log(`\n  只读检查《2026年【交接&跟进】表》『${子表}』…`);
  const { 矩阵, 落盘 } = 读工作表({ 表: "交接跟进表", 工作表: 子表, 落盘: "runtime/售后问题待跟进-全表.json" });

  // 表头行：第一行里能找到「是否已完结」的行。
  let 表头下标 = -1;
  for (let i = 0; i < Math.min(矩阵.length, 20); i += 1) {
    const 行 = (矩阵[i] || []).map(取文本);
    if (行.includes("是否已完结")) { 表头下标 = i; break; }
  }
  if (表头下标 < 0) throw new Error(`前 20 行里找不到「是否已完结」列，表结构可能变了（先人工看一眼 ${path.relative(仓库根, 落盘)}）`);

  const 表头 = (矩阵[表头下标] || []).map(取文本);
  const 列 = {
    时间: 找列(表头, ["登记时间"]),
    店铺: 找列(表头, ["店铺名称", "店铺"]),
    单号: 找列(表头, ["ID/订单编号", "订单编号", "ID"]),
    问题: 找列(表头, ["问题描述", "问题"]),
    完结: 找列(表头, ["是否已完结", "是否完成"]),
    备注: 找列(表头, ["备注"]),
    匹配: ["湖南", "京东仓", "撕单", "理赔", "异常件表"].map((名) => ({ 名, 列: 找列(表头, [名]) }))
  };
  if (列.完结 < 0) throw new Error("表头里缺少「是否已完结」列");

  const 未完结 = [];
  let 真实数据行 = 0;
  let 真实数据末行 = 表头下标 + 1;
  for (let i = 表头下标 + 1; i < 矩阵.length; i += 1) {
    const 行 = (矩阵[i] || []).map(取文本);
    const 有数据 = 取文本(行[列.时间]) || 取文本(行[列.单号]);
    if (!有数据) continue;
    真实数据行 += 1;
    真实数据末行 = i + 1;
    if (是已完结(行[列.完结])) continue;
    const 匹配值 = 列.匹配.map((m) => ({ 名: m.名, 值: m.列 > -1 ? 取文本(行[m.列]) : "" }));
    const 全无匹配 = 匹配值.every((m) => 是无匹配(m.值));
    未完结.push({
      行号: i + 1,
      登记时间: 取文本(行[列.时间]),
      店铺: 取文本(行[列.店铺]),
      单号: 取文本(行[列.单号]),
      问题描述: 取文本(行[列.问题]),
      备注: 列.备注 > -1 ? 取文本(行[列.备注]) : "",
      匹配: Object.fromEntries(匹配值.map((m) => [m.名, m.值])),
      全无匹配
    });
  }
  const 全无匹配数 = 未完结.filter((u) => u.全无匹配).length;

  console.log(`\n  表格规模：${矩阵.length} 行 × ${表头.length} 列（表头第 ${表头下标 + 1} 行；真实数据 ${真实数据行} 行，约到第 ${真实数据末行} 行，底部模板行不算）`);
  console.log(`  已完结 ${真实数据行 - 未完结.length} 行 / 未完结 ${未完结.length} 行；未完结里五列全无匹配 ${全无匹配数} 行`);
  console.log(`\n  ── 未完结清单（${未完结.length} 行）──`);
  for (const u of 未完结) {
    const 匹配文本 = Object.entries(u.匹配).map(([名, 值]) => `${名}=${值 || "空"}`).join(" ");
    console.log(`   第${u.行号}行 | ${u.登记时间 || "?"} | ${u.店铺 || "?"} | ${u.单号 || "?"} | ${(u.问题描述 || "").slice(0, 40)}`);
    console.log(`      ${匹配文本}${u.全无匹配 ? "  ← 五列全无匹配" : ""}`);
  }
  console.log("");

  if (参数.json) {
    const 输出 = 参数.jsonPath
      ? path.resolve(项目根, 参数.jsonPath)
      : path.join(项目根, "runtime", `售后问题待跟进-未完结-${新的时间戳()}.json`);
    fs.mkdirSync(path.dirname(输出), { recursive: true });
    fs.writeFileSync(输出, JSON.stringify({
      生成时间: new Date().toISOString(),
      子表,
      表格规模: { 行数: 矩阵.length, 列数: 表头.length, 表头行: 表头下标 + 1, 真实数据行, 真实数据末行 },
      统计: { 已完结: 真实数据行 - 未完结.length, 未完结: 未完结.length, 全无匹配: 全无匹配数 },
      未完结清单: 未完结,
      全无匹配清单: 未完结.filter((u) => u.全无匹配).map((u) => ({ 行号: u.行号, 登记时间: u.登记时间, 店铺: u.店铺, 单号: u.单号, 问题描述: u.问题描述 })),
      原始表: path.relative(仓库根, 落盘)
    }, null, 2), "utf8");
    console.log(`  结果已落盘：${path.relative(仓库根, 输出)}\n`);
  }
  console.log("");
}

function 新的时间戳() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

main().catch((错误) => {
  console.error(`\n  失败：${错误.message}\n`);
  process.exitCode = 1;
});
