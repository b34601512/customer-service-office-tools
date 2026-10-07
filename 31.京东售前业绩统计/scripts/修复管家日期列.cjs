#!/usr/bin/env node
// 31号：修复「管家数据-追加写入」已写入区间被金山当日期解析的 B/C/D（v2026-10-07.2 repair 模式）。
//
// 背景（2026-10-07 首次 --send 踩坑）：v1 只把 E/I 设文本格式，B 年月/C 咨询时间/D 下单时间
// 在常规格式下被存成日期序列号（"2026-09"→46266），回读不一致停手；本工具用 v2 的 repair
// 模式把指定区间按本地源文件（与导入脚本同一套映射）重写为文本，写完回读逐格比对 + 在线复核。
//
// 用法：
//   node scripts/修复管家日期列.cjs --manifest runtime/downloads/2026-09/manifest.json --year-month 2026-09 --起始行 2871 --行数 500            # dry-run
//   node scripts/修复管家日期列.cjs --manifest runtime/downloads/2026-09/manifest.json --year-month 2026-09 --起始行 2871 --行数 500 --send     # 真修
// 前置：黎路遥已把《脚本大全》管家脚本重贴为 v2026-10-07.2（工具会先 probe 校验版本，不是 v2 就拒绝）。
const path = require("node:path");
const 导入 = require("./导入管家数据.cjs");
const { 调脚本, 取webhook } = require("./AirScript调用.cjs");
const { 读工作表 } = require("./金山只读.cjs");

function 解析参数(argv) {
  const 参数 = { manifest: "", yearMonth: "", 起始行: 0, 行数: 0, send: false, 刷新映射: false, 映射缓存: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--manifest") { 参数.manifest = argv[i + 1] || ""; i += 1; }
    else if (词 === "--year-month") { 参数.yearMonth = argv[i + 1] || ""; i += 1; }
    else if (词 === "--起始行") { 参数.起始行 = Number(argv[i + 1]) || 0; i += 1; }
    else if (词 === "--行数") { 参数.行数 = Number(argv[i + 1]) || 0; i += 1; }
    else if (词 === "--send") 参数.send = true;
    else if (词 === "--刷新映射") 参数.刷新映射 = true;
    else if (词 === "--映射缓存") { 参数.映射缓存 = argv[i + 1] || ""; i += 1; }
    else if (词 === "--help" || 词 === "-h") 参数.help = true;
  }
  return 参数;
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (参数.help || !参数.manifest || !参数.yearMonth || !参数.起始行 || !参数.行数) {
    console.log("用法：node scripts/修复管家日期列.cjs --manifest <清单.json> --year-month 2026-09 --起始行 2871 --行数 500 [--send]");
    process.exit(参数.help ? 0 : 2);
  }
  // 与导入脚本同一套读文件+映射
  const 清单 = 导入.读清单({ manifest: 参数.manifest, yearMonth: 参数.yearMonth, file: "", store: "" });
  const { 全部行 } = 导入.加载全部({ file: "", manifest: 参数.manifest, store: "", yearMonth: 参数.yearMonth, batch: 500, 跳过前: 0, 映射缓存: 参数.映射缓存, 刷新映射: 参数.刷新映射 }, 清单);
  const 切片 = 全部行.slice(0, 参数.行数);
  if (切片.length !== 参数.行数) throw new Error(`本地只算出 ${切片.length} 行，不足 --行数 ${参数.行数}`);
  console.log(`待修复：第 ${参数.起始行}~${参数.起始行 + 参数.行数 - 1} 行（${参数.行数} 行），首行 A=${切片[0][0]}，年月=${切片[0][1]}，咨询时间=${切片[0][2]}`);

  if (!参数.send) {
    console.log("（dry-run：不写云端；加 --send 才真修）");
    console.log("样例前 2 行：");
    for (const 行 of 切片.slice(0, 2)) console.log("  " + JSON.stringify(行));
    return;
  }

  if (!取webhook("append_guanjia")) throw new Error("没配 append_guanjia webhook（project-config/kdocs-airscript.local.json）");
  const 探 = await 调脚本("append_guanjia", { probe: true });
  if (探.scriptVersion !== "2026-10-07.2") {
    throw new Error(`云端脚本版本是 ${探.scriptVersion}，不是 v2026-10-07.2（repair 模式）——请先重贴新版再跑。`);
  }
  console.log(`云端脚本 ${探.scriptVersion}，当前末行 ${探.lastRow}；开始修复…`);
  const 回 = await 调脚本("append_guanjia", {
    repair: { startRow: 参数.起始行, rows: 切片, expectFirstA: 切片[0][0] },
    allowWrite: true
  });
  if (!回.written || 回.mismatchedRows) {
    throw new Error(`repair 失败：${JSON.stringify(回).slice(0, 500)}`);
  }
  console.log(`repair 回执：写 ${回.rows} 行（第 ${回.firstRow}~${回.lastRow} 行），回读 0 差异，firstA=${回.firstA}`);

  // 在线复核：直接读表比对 B/C/D 文本
  const 表 = 读工作表({ 表: "管家表", 工作表: "明细", 落盘: path.join("runtime", "kdocs", `表A明细-修复后-${Date.now()}.json`) });
  const 矩阵 = 表.矩阵;
  let 不一致 = 0;
  let 首差 = "";
  for (let i = 0; i < 切片.length; i += 1) {
    const 在线 = 矩阵[参数.起始行 - 1 + i] || [];
    for (const c of [1, 2, 3]) {
      if (String(在线[c] ?? "").trim() !== String(切片[i][c] ?? "").trim()) {
        不一致 += 1;
        if (!首差) 首差 = `第${参数.起始行 + i}行 第${c + 1}列 期望[${切片[i][c]}] 实际[${在线[c]}]`;
        break;
      }
    }
  }
  if (不一致) throw new Error(`在线复核不一致 ${不一致} 行：${首差}`);
  console.log(`在线复核通过：${切片.length} 行 B/C/D 全部与本地一致（应有=实有）。`);
}

main().catch((e) => { console.error(`\n  失败：${e.message}\n`); process.exitCode = 1; });
