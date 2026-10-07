#!/usr/bin/env node
// 31号：把 京东魔方「客服销售分析」导出文件 导入《京东客服询单业绩汇总（魔方数据）》Sheet1（在线追加）。
//
// 数据链：
//   魔方【数据分析→成交分析→客服销售分析】导出「客服销售分析_YYYY-MM-DD_YYYY-MM-DD_全部客服.xlsx」
//   → 本脚本：去「已取消」→ 去 0 金额（--保留零金额 可留）→ 映射成 13 列（店铺｜年月｜订单编号｜顾客昵称｜订单状态｜
//      下单时间｜付款时间｜出库时间｜订单金额（元）｜客服昵称｜开始时间｜结束时间｜种菜(=顾客mofangID)）
//   → POST 31号 AirScript「魔方数据-追加写入」同步 webhook（**只追加、保留历史**；见《脚本大全》）。
//
// 用法：
//   node scripts/导入魔方数据.cjs --file <客服销售分析xlsx> --store 京东1店 --year-month 2026-09 [--dry-run|--send|--verify|--probe]
//   node scripts/导入魔方数据.cjs --manifest <清单.json> [--dry-run|--send|--verify]
//   · 默认 --dry-run：只读源文件，打印统计 + 映射后前 3 行；不写云端。
//   · --send：分批 POST（默认每批 500 行），每批带 expectedLastRow 防重复；写完自动读在线核对。
//   · --verify：读在线 Sheet1，按 店铺 逐行核对（期望=源文件映射后行；查缺/多/重复）。
//   · --probe：调云端探针，不写。
//   · 魔方文件里没有店铺信息，必须显式给 --store（或清单里写 store）；--保留零金额 保留 0 元行（与 8 月人工批次一致）。
//   清单格式：{"yearMonth":"2026-09","files":[{"file":"…xlsx","store":"京东1店"},{"file":"…xlsx","store":"京东3店"}]}
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require(path.resolve(__dirname, "..", "..", "9.客服数据自动更新", "node_modules", "xlsx"));
const { 读工作表, 项目根 } = require("./金山只读.cjs");
const { 调脚本, 取webhook } = require("./AirScript调用.cjs");

const 目标表 = "魔方表";
const 目标子表 = "Sheet1";
const 源列名 = ["订单编号", "顾客昵称", "订单状态", "下单时间", "付款时间", "出库时间", "订单金额（元）", "客服昵称", "开始时间", "结束时间", "顾客mofangID"];

function 解析参数(argv) {
  const 参数 = { mode: "dry-run", file: "", manifest: "", store: "", yearMonth: "", batch: 500, 保留零金额: false, 帮助: false };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--file") { 参数.file = argv[i + 1] || ""; i += 1; }
    else if (词 === "--manifest") { 参数.manifest = argv[i + 1] || ""; i += 1; }
    else if (词 === "--store") { 参数.store = argv[i + 1] || ""; i += 1; }
    else if (词 === "--year-month") { 参数.yearMonth = argv[i + 1] || ""; i += 1; }
    else if (词 === "--batch") { 参数.batch = Number(argv[i + 1]) || 500; i += 1; }
    else if (词 === "--保留零金额") 参数.保留零金额 = true;
    else if (词 === "--dry-run") 参数.mode = "dry-run";
    else if (词 === "--send") 参数.mode = "send";
    else if (词 === "--verify") 参数.mode = "verify";
    else if (词 === "--probe") 参数.mode = "probe";
    else if (词 === "--help" || 词 === "-h") 参数.帮助 = true;
  }
  return 参数;
}

function 用法() {
  console.log(`用法：
  node scripts/导入魔方数据.cjs --file <客服销售分析xlsx> --store 京东1店 --year-month 2026-09 [--dry-run|--send|--verify|--probe]
  node scripts/导入魔方数据.cjs --manifest <清单.json> [--dry-run|--send|--verify]`);
}

function 读清单(参数) {
  if (参数.manifest) {
    const 清单 = JSON.parse(fs.readFileSync(参数.manifest, "utf8"));
    const files = (清单.files || []).map((f) => ({ file: f.file, store: f.store || 参数.store || "" }));
    if (!files.length) throw new Error("清单里 files 是空的");
    return { yearMonth: 参数.yearMonth || 清单.yearMonth || "", files };
  }
  if (!参数.file) throw new Error("要么 --file 单文件，要么 --manifest 清单");
  return { yearMonth: 参数.yearMonth, files: [{ file: 参数.file, store: 参数.store }] };
}

function 读xlsx(文件) {
  if (!fs.existsSync(文件)) throw new Error(`找不到源文件：${文件}`);
  const wb = XLSX.readFile(文件);
  const sheetName = wb.SheetNames.find((n) => n.includes("客服销售分析")) || wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, raw: true });
}

function 去空白(v) { return String(v ?? "").replace(/^[\s\u3000]+/, "").replace(/[\s\u3000]+$/, ""); }
function 数值(v) { return typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")) || 0; }

// 读一个源文件 → 映射后的 13 列行 + 统计
function 处理文件(文件, 店铺, 年月, 参数) {
  if (!店铺) throw new Error(`魔方文件里没有店铺信息，必须给 --store（或清单里写 store）。文件：${文件}`);
  const 原始 = 读xlsx(文件);
  if (原始.length < 2) throw new Error(`源文件没有数据行：${文件}`);
  const 表头行 = 原始[0].map((v) => 去空白(v));
  const 列号 = {};
  for (const 名 of 源列名) {
    const idx = 表头行.indexOf(名);
    if (idx < 0) throw new Error(`源文件表头里没有「${名}」（实际：${表头行.join("、")}）。文件：${文件}`);
    列号[名] = idx;
  }
  const 行列表 = 原始.slice(1).filter((行) => 行.some((v) => 去空白(v)));
  const 统计 = { 源总行: 行列表.length, 已取消: 0, 零金额: 0, 整行重复: 0 };
  const seen = new Set();
  const rows = [];
  for (const 行 of 行列表) {
    const 状态 = 去空白(行[列号["订单状态"]]);
    if (状态.includes("取消")) { 统计.已取消 += 1; continue; }
    const 金额 = 数值(行[列号["订单金额（元）"]]);
    if (!参数.保留零金额 && Math.abs(金额) < 1e-9) { 统计.零金额 += 1; continue; }
    const 行数据 = [
      店铺, 年月,
      去空白(行[列号["订单编号"]]), 去空白(行[列号["顾客昵称"]]),
      状态, 去空白(行[列号["下单时间"]]), 去空白(行[列号["付款时间"]]), 去空白(行[列号["出库时间"]]),
      金额, 去空白(行[列号["客服昵称"]]),
      去空白(行[列号["开始时间"]]), 去空白(行[列号["结束时间"]]), 去空白(行[列号["顾客mofangID"]])
    ];
    const 键 = JSON.stringify(行数据);
    if (seen.has(键)) { 统计.整行重复 += 1; continue; }
    seen.add(键);
    rows.push(行数据);
  }
  return { store: 店铺, rows, 统计 };
}

function 加载全部(参数, 清单) {
  if (!清单.yearMonth) throw new Error("缺 --year-month（如 2026-09）：年月不能从下单时间推断（批次跨月）。");
  const 结果 = [];
  let 总行 = 0;
  for (const 条目 of 清单.files) {
    const 处理 = 处理文件(条目.file, 条目.store, 清单.yearMonth, 参数);
    结果.push({ 文件: 条目.file, ...处理 });
    总行 += 处理.rows.length;
    console.log(`  · ${path.basename(条目.file)} → ${处理.store}：源 ${处理.统计.源总行} 行，去已取消 ${处理.统计.已取消}，去零金额 ${处理.统计.零金额}，整行重复 ${处理.统计.整行重复}，入库 ${处理.rows.length} 行`);
  }
  console.log(`  合计入库：${总行} 行（年月=${清单.yearMonth}${参数.保留零金额 ? "；保留零金额" : "；已去掉零金额"}）`);
  const 全部行 = 结果.flatMap((r) => r.rows);
  const 键计数 = new Map();
  for (const 行 of 全部行) {
    const 键 = 记录键(行);
    键计数.set(键, (键计数.get(键) || 0) + 1);
  }
  const 重 = [...键计数.entries()].filter(([, n]) => n > 1);
  if (重.length) throw new Error(`发现 ${重.length} 个订单号在多份文件里重复（前 3：${重.slice(0, 3).map(([k, n]) => `${k}×${n}`).join("；")}），停止导入，人工核对文件是否重复导出。`);
  return { 结果, 全部行 };
}

function 记录键(行) { return `${去空白(行[0])}|${去空白(行[2])}`; }

async function 探针() {
  const 结果 = await 调脚本("append_mofang", { probe: true });
  console.log(`  云端探针：${JSON.stringify(结果)}`);
  return 结果;
}

async function 发送(全部行, 批次 = 500) {
  if (!取webhook("append_mofang")) {
    throw new Error("等黎路遥粘贴后补 webhook：把《脚本大全》「魔方数据-追加写入」那行粘到《京东客服询单业绩汇总（魔方数据）》的 AirScript，生成同步 webhook，" +
      "填进 31号 project-config/kdocs-airscript.local.json 的 scripts.append_mofang.webhookUrl。");
  }
  const 探 = await 调脚本("append_mofang", { probe: true });
  if (!探.headerOk) throw new Error(`云端表头没就位（probe=${JSON.stringify(探)}），拒绝写入。`);
  let 末行 = 探.lastRow;
  console.log(`  写入前：在线数据 ${探.dataRows} 行，末行 ${末行}；本批 ${全部行.length} 行，每批 ${批次} 行。`);
  for (let i = 0; i < 全部行.length; i += 批次) {
    const 块 = 全部行.slice(i, i + 批次);
    const 结果 = await 调脚本("append_mofang", { rows: 块, allowWrite: true, expectedLastRow: 末行 });
    if (!结果.written || 结果.rows !== 块.length) throw new Error(`第 ${i / 批次 + 1} 批写入失败：${JSON.stringify(结果).slice(0, 400)}`);
    if (结果.mismatchedRows) throw new Error(`第 ${i / 批次 + 1} 批回读有 ${结果.mismatchedRows} 行不一致（${结果.firstMismatch}），停下人工核对。`);
    末行 = 结果.lastRow;
    console.log(`  · 批 ${i / 批次 + 1}：写 ${结果.rows} 行（第 ${结果.firstRow}~${结果.lastRow} 行），回读比对 0 差异`);
  }
  console.log(`  写入完成：末行 ${末行}。`);
  return 末行;
}

function 核对(全部行, 年月) {
  const 在线 = 读工作表({ 表: 目标表, 工作表: 目标子表 }).矩阵;
  const 在线计数 = new Map();
  let 在线行数 = 0;
  for (const 行 of 在线.slice(1)) {
    if (去空白(行[1]) !== 年月) continue;
    在线行数 += 1;
    const 键 = 记录键(行);
    在线计数.set(键, (在线计数.get(键) || 0) + 1);
  }
  const 期望计数 = new Map();
  for (const 行 of 全部行) {
    const 键 = 记录键(行);
    期望计数.set(键, (期望计数.get(键) || 0) + 1);
  }
  let 缺 = 0; let 多 = 0; let 重复 = 0;
  const 缺样本 = []; const 多样本 = [];
  for (const [键, 次] of 期望计数) {
    const 有 = 在线计数.get(键) || 0;
    if (!有) { 缺 += 1; if (缺样本.length < 3) 缺样本.push(`${键}(期望${次})`); }
  }
  for (const [键, 次] of 在线计数) {
    if (!期望计数.has(键)) { 多 += 1; if (多样本.length < 3) 多样本.push(`${键}(在线${次})`); }
    if (次 > 1) 重复 += 1;
  }
  console.log(`  核对「${年月}」：期望 ${全部行.length} 行 / 在线 ${在线行数} 行；缺 ${缺} 行，多 ${多} 行，重复 ${重复} 行`);
  if (缺样本.length) console.log(`    缺样本：${缺样本.join("；")}`);
  if (多样本.length) console.log(`    多样本：${多样本.join("；")}`);
  return { 期望: 全部行.length, 在线: 在线行数, 缺, 多, 重复 };
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (参数.帮助) { 用法(); return; }
  if (参数.mode === "probe") {
    await 探针();
    return;
  }
  const 清单 = 读清单(参数);
  console.log(`  模式=${参数.mode} 年月=${清单.yearMonth || "(未给)"} 文件数=${清单.files.length}`);
  const { 全部行 } = 加载全部(参数, 清单);
  if (参数.mode === "dry-run") {
    console.log(`\n  映射后前 3 行：`);
    for (const 行 of 全部行.slice(0, 3)) console.log("    " + JSON.stringify(行));
    if (取webhook("append_mofang")) {
      try {
        const 探 = await 调脚本("append_mofang", { probe: true });
        console.log(`  云端现状（探针）：数据 ${探.dataRows} 行，末行 ${探.lastRow}，表头就位=${探.headerOk}`);
      } catch (error) { console.log(`  （云端探针失败：${error.message}）`); }
    } else {
      console.log("  （还没配 webhook：等黎路遥粘贴后补，dry-run 到此为止）");
    }
    return;
  }
  if (参数.mode === "send") {
    await 发送(全部行, 参数.batch);
    const 结果 = 核对(全部行, 清单.yearMonth);
    if (结果.缺 || 结果.多 || 结果.重复) throw new Error("写入后核对不一致，停下人工核对。");
    console.log("  写入后核对通过：应有=实有。");
    return;
  }
  if (参数.mode === "verify") {
    const 结果 = 核对(全部行, 清单.yearMonth);
    if (结果.缺 || 结果.多 || 结果.重复) throw new Error("核对不一致，停下人工核对。");
    console.log("  核对通过：应有=实有。");
    return;
  }
  throw new Error(`未知模式：${参数.mode}`);
}

main().catch((error) => {
  console.error(`\n  失败：${error.message}\n`);
  process.exitCode = 1;
});
