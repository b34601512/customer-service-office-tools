#!/usr/bin/env node
// 修 33号《产品问题反馈表》里 2026-10-30「吸氧管有水」那 19 行：按追踪ID 定位，不信行号。
// 为什么会有这个脚本：共享在线表行号会被别人改动整体上移，按行号写会错行（2026-10-30 实际踩到）。
// 用法：node 修-水珠行.cjs            # 干跑，只打印差异
//       node 修-水珠行.cjs --写        # 真写，写完回读核对
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CLI = "C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js";
const DOCID = "e3_AFMAdwb9AAYCNWqYmWTycQumhjFGA";
const SHEET = "BB08J2";
const 真写 = process.argv.includes("--写");
const 字格式 = { font_family: "SimSun", font_size: 12 };

const 备 = "来源＝探域调优坊调优记录（追踪ID 可在调优工坊直接搜）。同组「吸氧管有水/冷凝水」近一个月共 19 位客户（本单是其中 1 位），长期反复、一直没解决，建议产品部推动整改。19 人全量原话：D:/硅基公司/员工/09.探域专员·殷素素/任务/2026-10-30-水珠反馈统计/核对.md";

// 追踪ID → 该行应有的型号与反馈日期
const 应有 = {
  "6adab9b687c78d5599f168bb": { 型号: "C1L（货号 C1-3）", 日期: "2026/10/23" },
  "6ad33e4556bb1868356f1c6f": { 型号: "1SW（1SW01）", 日期: "2026/10/17" },
  "6abf5af9797207036d232d14": { 型号: "DE-1S（买家铭牌）", 日期: "2026/10/02" },
  "6ac9f24a48cf0f65414f79c2": { 型号: "未知（后台无型号字段、售前未下单）", 日期: "2026/10/10" },
};

const 显示器行备注 = "C1这个显示器脱离，已经出现2次了。截图 3 张在 27.企业微信机器人/.state/media/（企业微信截图_17923724163947.png、企业微信截图_17923723966051.png、e942f2200f2b5fc466efef55e0eb60dd_compress.jpg）。在线表格 API 不能贴图，需人工贴到图片列。";

function 调(args) {
  const out = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf("{")));
}

function 读网格(范围) {
  const j = 调(["sheet", "ranges", "get", "--docid", DOCID, "--sheet-id", SHEET, "--mode", "default", "--range", 范围]);
  const rows = (j.grid_data && j.grid_data.rows) || [];
  const 起始 = Number((范围.match(/^A(\d+)/) || [0, 1])[1]);
  return rows.map((r, i) => ({
    行号: 起始 + i,
    格: (r.values || []).map((c) => String((c.cell_value && c.cell_value.text) || "")),
  }));
}

function 写格(range, value) {
  const body = JSON.stringify({ docid: DOCID, sheet: SHEET, range, cell: { value, style: 字格式 } });
  const j = 调(["sheet", "cells", "set", "--json", body]);
  if (j.errcode) throw new Error(`${range} 写入失败 errcode=${j.errcode}`);
}

const 表 = 读网格("A70:M100");
const 改动 = [];
for (const { 行号, 格 } of 表) {
  const D = 格[3] || "";
  const id = (D.match(/[0-9a-f]{24}/) || [])[0];
  if (!id) {
    if (/显示屏/.test(格[3] || "") && /C1/.test(格[2] || "")) {
      if (格[5] !== "2026/10/19") 改动.push({ 行号, 列: "F", 原: 格[5], 新: "2026/10/19" });
      if (格[8] !== 显示器行备注) 改动.push({ 行号, 列: "I", 原: 格[8].slice(0, 20), 新: 显示器行备注 });
    }
    continue;
  }
  const 目标 = 应有[id];
  if (!目标) continue; // 其余 15 行型号/日期已对，跳过
  if (格[2] !== 目标.型号) 改动.push({ 行号, 列: "C", 原: 格[2], 新: 目标.型号 });
  if (格[5] !== 目标.日期) 改动.push({ 行号, 列: "F", 原: 格[5], 新: 目标.日期 });
  if (格[8] !== 备) 改动.push({ 行号, 列: "I", 原: 格[8].slice(0, 20), 新: 备 });
}

console.log(`待改 ${改动.length} 处：`);
for (const c of 改动) console.log(`  ${c.列}${c.行号}：${String(c.原).slice(0, 26)} → ${String(c.新).slice(0, 26)}`);

if (真写) {
  for (const c of 改动) {
    写格(`${c.列}${c.行号}`, c.新);
    console.log(`  已写 ${c.列}${c.行号}`);
  }
  // 回读核对
  const 后 = 读网格("A70:M100");
  const 坏 = [];
  let 数 = 0;
  for (const { 行号, 格 } of 后) {
    const id = ((格[3] || "").match(/[0-9a-f]{24}/) || [])[0];
    if (!id) continue;
    if (格[0] !== "2026/10/30") continue;
    数 += 1;
    const 目标 = 应有[id];
    if (目标) {
      if (格[2] !== 目标.型号 || 格[5] !== 目标.日期) 坏.push(`${行号} 型号/日期不符`);
    }
    if (格[8] !== 备) 坏.push(`${行号} 备注未统一`);
  }
  console.log(`回读：2026/10/30 共 ${数} 行，问题 ${坏.length} 处${坏.length ? "：" + 坏.join("；") : "，全对 ✓"}`);
} else {
  console.log("（干跑，没写。确认后加 --写）");
}
