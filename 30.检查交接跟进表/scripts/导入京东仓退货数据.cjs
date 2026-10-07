#!/usr/bin/env node
// 30号：把京东物流【退货至京东库房管理】导出的明细 CSV 导入《退款检测文件》『京东仓退货数据』。
//
// 数据链（立项 2026-10-07）：
//   24号 jd-warehouse-returns.js 下载 CSV（wl.jdl.com，最近 3 个月，GB18030）
//   → 本脚本映射成 3 列（销售平台单号｜逆向运单号｜是否退回=已退回京东仓），按「单号+运单号」去重
//   → POST《退款检测文件》AirScript「京东仓退货数据-写入」的同步 webhook（该脚本覆盖写、保留表头；见《脚本大全》）。
//
// 用法：
//   node scripts/导入京东仓退货数据.cjs [--csv <路径>] [--dry-run|--send|--verify] [--no-compare]
//   · 默认 --dry-run：只读 CSV，打印统计 + 前 5 行；再读一刀现有表行数做对比（--no-compare 可跳过）。
//   · --send：POST webhook（需要本机 project-config/kdocs-airscript.local.json 的 scripts.write_jd_warehouse.webhookUrl；
//             没有就退出码 2 并提示「等黎路遥粘贴后补 webhook」）。失败不自动重试。
//   · --verify：用 24号 read-kdocs 回读『京东仓退货数据』，比对 应有（CSV 去重后）vs 实有。
//   · --csv 不给时取 24号/runtime/jd/ 下最新的 京东仓退货*.csv。
const fs = require("node:fs");
const path = require("node:path");
const { 读工作表, 项目根, 仓库根 } = require("./金山只读.cjs");

const CSV目录 = path.join(仓库根, "24.平台退款复查", "runtime", "jd");
const 数据表 = "京东仓退货数据";
const 退回值 = "已退回京东仓";

function 解析参数(argv) {
  const 参数 = { 模式: "dry-run", csv: "", noCompare: false, 帮助: false };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--csv") { 参数.csv = argv[i + 1] || ""; i += 1; }
    else if (词 === "--dry-run") 参数.模式 = "dry-run";
    else if (词 === "--send") 参数.模式 = "send";
    else if (词 === "--verify") 参数.模式 = "verify";
    else if (词 === "--no-compare") 参数.noCompare = true;
    else if (词 === "--help" || 词 === "-h") 参数.帮助 = true;
  }
  return 参数;
}

function 找最新CSV() {
  if (!fs.existsSync(CSV目录)) throw new Error(`没有 24号 京东仓导出目录：${CSV目录}（先跑 24号 jd-warehouse-returns.js 下载）`);
  const 候选 = fs.readdirSync(CSV目录)
    .filter((名) => /^京东仓退货.*\.csv$/i.test(名))
    .map((名) => { const 全 = path.join(CSV目录, 名); return { 全, 修改: fs.statSync(全).mtimeMs }; })
    .sort((a, b) => b.修改 - a.修改);
  if (!候选.length) throw new Error(`目录里没有 京东仓退货*.csv：${CSV目录}`);
  return 候选[0].全;
}

// —— 下面两个纯函数与 24号 src/tools/jd-warehouse-returns.js 同源（京东导出实测 GB18030）——
function 解码CSV(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return new TextDecoder("utf-8").decode(buffer);
  try { return new TextDecoder("gb18030").decode(buffer); } catch { return new TextDecoder("utf-8").decode(buffer); }
}

function 解析CSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch === "\r") { /* 跳过 */ }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

function 清理表头(v) {
  return String(v ?? "").trim().replace(/^"|"$/g, "");
}

// CSV → 3 列（单号｜运单号｜已退回京东仓），按「单号+运单号」去重。
function 映射数据(行列表) {
  if (!行列表.length) throw new Error("CSV 是空的");
  const 表头 = 行列表[0].map(清理表头);
  const 单号列 = 表头.indexOf("销售平台单号");
  const 运单列 = 表头.indexOf("逆向运单号");
  if (单号列 < 0) throw new Error(`CSV 表头里没有「销售平台单号」（实际：${表头.join("、").slice(0, 300)}）`);
  if (运单列 < 0) throw new Error(`CSV 表头里没有「逆向运单号」（实际：${表头.join("、").slice(0, 300)}）`);
  const 去重 = new Map();
  const 统计 = { 明细行: 0, 空单号: 0, 空运单: 0, 重复: 0 };
  for (const 行 of 行列表.slice(1)) {
    统计.明细行 += 1;
    const 单号 = String(行[单号列] ?? "").trim().replace(/\t/g, "");
    const 运单 = String(行[运单列] ?? "").trim().replace(/\t/g, "");
    if (!单号) { 统计.空单号 += 1; continue; }
    if (!运单) { 统计.空运单 += 1; continue; }
    const 键 = `${单号}|${运单}`;
    if (去重.has(键)) { 统计.重复 += 1; continue; }
    去重.set(键, [单号, 运单, 退回值]);
  }
  return { 列: { 单号列, 运单列, 表头 }, rows: [...去重.values()], 统计 };
}

function 读金山配置() {
  const 配置路径 = path.join(项目根, "project-config", "kdocs-airscript.local.json");
  if (!fs.existsSync(配置路径)) return { scripts: {} };
  return JSON.parse(fs.readFileSync(配置路径, "utf8"));
}

// 令牌跨脚本可用：本配置没有 → 回退读 7号 那份；7号 那份若也没有 → 顺它自己的 tokenFallbackFile 再读 12号
// （2026-10-07 实测：令牌实际放在 12号 project-config/platform-config.json 的 kdocsDataSourceSync.apiToken）。
function 解析令牌配置(文件路径) {
  const 配置 = JSON.parse(fs.readFileSync(文件路径, "utf8"));
  if (配置.apiToken) return 配置.apiToken;
  const 相对 = 配置.tokenFallbackFile || 配置.apiTokenFallbackFile || "../12.店铺指标数据自动更新/project-config/platform-config.json";
  const 二级路径 = path.resolve(path.dirname(path.dirname(文件路径)), 相对); // 相对「那份配置所在的项目根」
  if (fs.existsSync(二级路径)) {
    const 二级配置 = JSON.parse(fs.readFileSync(二级路径, "utf8"));
    const 令牌 = (二级配置.kdocsDataSourceSync || {}).apiToken;
    if (令牌) return 令牌;
  }
  return "";
}

function 取令牌(配置) {
  if (配置.apiToken) return 配置.apiToken;
  const 回退 = path.resolve(项目根, 配置.apiTokenFallbackFile || "../2.发票自动化/7.自动登记发票/project-config/kdocs-airscript.json");
  if (fs.existsSync(回退)) {
    const 令牌 = 解析令牌配置(回退);
    if (令牌) return 令牌;
  }
  return "";
}

function 计数数据行(矩阵) {
  let 行数 = 0;
  for (let i = 1; i < 矩阵.length; i += 1) {
    if (String((矩阵[i] || [])[0] ?? "").trim()) 行数 += 1;
  }
  return 行数;
}

async function 发送(rows) {
  const 配置 = 读金山配置();
  const 条目 = (配置.scripts || {}).write_jd_warehouse || {};
  const webhookUrl = String(条目.webhookUrl || "").trim();
  if (!webhookUrl) {
    console.error(`\n  等黎路遥粘贴后补 webhook：先把《脚本大全》里的「京东仓退货数据-写入」粘到《退款检测文件》的 AirScript 并生成同步 webhook，`);
    console.error(`  再把地址填进 30.检查交接跟进表/project-config/kdocs-airscript.local.json 的 scripts.write_jd_warehouse.webhookUrl（本机文件，不入库）。\n`);
    process.exitCode = 2;
    return;
  }
  const 令牌 = 取令牌(配置);
  if (!令牌) {
    console.error("\n  缺少 AirScript-Token：请把令牌填进 30号 project-config/kdocs-airscript.local.json 的 apiToken（或配 apiTokenFallback 指向 7号 配置）。\n");
    process.exitCode = 2;
    return;
  }
  console.log(`  发送 ${rows.length} 行 → ${webhookUrl.slice(0, 72)}…`);
  const 响应 = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "AirScript-Token": 令牌 },
    body: JSON.stringify({ Context: { argv: { rows, allowWrite: true } } }),
    signal: AbortSignal.timeout(180000)
  });
  const 文本 = await 响应.text();
  if (!响应.ok) throw new Error(`金山接口返回 HTTP ${响应.status}：${文本.slice(0, 300)}`);
  let 载荷 = null;
  try { 载荷 = JSON.parse(文本); } catch { throw new Error(`金山接口没有返回可解析的 JSON：${文本.slice(0, 300)}`); }
  if (载荷.error) throw new Error(`金山脚本报错：${String(载荷.error).slice(0, 300)}`);
  const 原始 = 载荷.data ? 载荷.data.result : 载荷.result;
  if (原始 === undefined || 原始 === null || 原始 === "[Undefined]") {
    throw new Error("金山脚本没有返回结果：确认脚本已保存，且最后一行是 return main()。");
  }
  const 结果 = typeof 原始 === "object" ? 原始 : JSON.parse(String(原始));
  console.log(`\n  远端返回：written=${结果.written} rows=${结果.rows} beforeRows=${结果.beforeRows} lastRow=${结果.lastRow} cleared=${结果.cleared} textFormat=${结果.textFormat}`);
  if (结果.message) console.log(`  说明：${结果.message}`);
  if (Array.isArray(结果.readBack) && 结果.readBack.length) console.log(`  回读：\n    ${结果.readBack.join("\n    ")}`);
  if (!结果.written) {
    console.error("\n  远端没有确认写入（written=false），请人工看上面的返回。\n");
    process.exitCode = 1;
    return;
  }
  console.log(`\n  下一步：node scripts/导入京东仓退货数据.cjs --verify（回读表核对 应有 vs 实有）。\n`);
}

async function 核验(rows) {
  console.log("  回读『京东仓退货数据』…");
  const { 矩阵, 落盘 } = 读工作表({ 表: "退款检测文件", 工作表: 数据表, 落盘: "runtime/核验-京东仓退货数据.json" });
  const 实有 = 计数数据行(矩阵);
  const 应有 = rows.length;
  const 首行 = 矩阵[1] ? (矩阵[1] || []).slice(0, 3).map((v) => String(v ?? "")) : [];
  const 末行 = 矩阵[实有] ? (矩阵[实有] || []).slice(0, 3).map((v) => String(v ?? "")) : [];
  console.log(`\n  验收（应有值 vs 实有值）：`);
  console.log(`    应有 ${应有} 行（CSV 去重后） / 实有 ${实有} 行 → ${应有 === 实有 ? "一致 ✓" : "不一致 ✗"}`);
  console.log(`    表头：${(矩阵[0] || []).slice(0, 3).map((v) => String(v ?? "")).join(" | ")}`);
  console.log(`    首行：${首行.join(" | ")}`);
  console.log(`    末行：${末行.join(" | ")}`);
  console.log(`    回读落盘：${path.relative(仓库根, 落盘)}`);
  if (应有 !== 实有) {
    console.error("\n  行数不一致——停下来人工核对，不要重复发送（失败不自动重试）。\n");
    process.exitCode = 1;
  } else {
    console.log("");
  }
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (参数.帮助) {
    console.log("用法：node scripts/导入京东仓退货数据.cjs [--csv <路径>] [--dry-run|--send|--verify] [--no-compare]");
    return;
  }
  const csv = 参数.csv ? path.resolve(参数.csv) : 找最新CSV();
  if (!fs.existsSync(csv)) throw new Error(`CSV 不存在：${csv}`);
  const { rows, 统计 } = 映射数据(解析CSV(解码CSV(fs.readFileSync(csv))));
  console.log(`\n  京东仓退货导入（${参数.模式}）`);
  console.log(`  CSV：${path.relative(仓库根, csv)}`);
  console.log(`  明细 ${统计.明细行} 行（空单号 ${统计.空单号}、空运单 ${统计.空运单}、重复 ${统计.重复}）→ 去重后 ${rows.length} 行 × 3 列`);

  if (参数.模式 === "dry-run") {
    console.log(`\n  前 5 行：`);
    for (const 行 of rows.slice(0, 5)) console.log(`    ${行.join(" | ")}`);
    if (!参数.noCompare) {
      console.log(`\n  与现有表对比（读 24号 read-kdocs，只读）：`);
      try {
        const { 矩阵 } = 读工作表({ 表: "退款检测文件", 工作表: 数据表 });
        const 实有 = 计数数据行(矩阵);
        console.log(`    现有表实有数据 ${实有} 行；本次应有 ${rows.length} 行 → 覆盖后差 ${rows.length - 实有}`);
      } catch (错误) {
        console.log(`    （现有表行数读取失败，跳过对比，不影响 dry-run：${错误.message.slice(0, 200)}）`);
      }
    }
    console.log(`\n  确认无误后：node scripts/导入京东仓退货数据.cjs --send\n`);
    return;
  }
  if (参数.模式 === "send") return 发送(rows);
  return 核验(rows);
}

main().catch((错误) => {
  console.error(`\n  失败：${错误.message}\n`);
  process.exitCode = 1;
});
