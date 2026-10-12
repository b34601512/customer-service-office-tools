#!/usr/bin/env node
// 33号 同步：把《2026年【交接&跟进】表》『产品问题』子表 → 企微《产品问题反馈表》(在线表格 sheet)。
// 只读金山（24号 只读通道）→ 写企微（sheet contents update，全量覆盖 A 起）→ 回读核对。
// docid / sheet_id 在本机 project-config/企微产品问题表.local.json（不入库）。
//
// 用法：
//   node scripts/同步到企微表.cjs            # 正式同步（写企微 + 回读核对）
//   node scripts/同步到企微表.cjs --预演      # 只读两边，打印将写内容，不写
// 失败不自动重试；写失败或回读缺格就停手报人。
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { 读工作表, 项目根 } = require("./金山只读.cjs");

const WECOM = "C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js";
const 配置路径 = path.join(项目根, "project-config", "企微产品问题表.local.json");

function 读配置() {
  if (!fs.existsSync(配置路径)) {
    throw new Error(`缺少本机配置 ${path.relative(项目根, 配置路径)}（形如 {"docid":"…","sheet_id":"…","说明":"…"}，不入库）`);
  }
  const c = JSON.parse(fs.readFileSync(配置路径, "utf8"));
  if (!c.docid || !c.sheet_id) throw new Error("配置缺 docid / sheet_id");
  return c;
}

function 调企微(参数) {
  return execFileSync(process.execPath, [WECOM, ...参数], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
}

function 取返回载荷(文本) {
  const 起 = 文本.indexOf("{");
  if (起 < 0) throw new Error(`企微返回没有 JSON：${文本.slice(0, 300)}`);
  const 载荷 = JSON.parse(文本.slice(起));
  if (载荷.errcode) throw new Error(`企微接口报错 errcode=${载荷.errcode}：${载荷.errmsg || ""}`);
  return 载荷;
}

const 预演 = process.argv.includes("--预演");
const 配置 = 读配置();

// 1) 读金山（实时）
const 金山 = 读工作表({ 表: "交接跟进表", 工作表: "产品问题" });
const 矩阵 = 金山.矩阵.filter((行) => 行 && 行.some((格) => String(格 == null ? "" : 格).trim() !== ""));
console.log(`金山『产品问题』：${矩阵.length} 行（表头+数据）`);

const grid = {
  start_row: 0,
  start_column: 0,
  rows: 矩阵.map((行) => ({
    values: 行.map((值) => ({ cell_value: { text: String(值 == null ? "" : 值) }, data_type: "TEXT" }))
  }))
};

if (预演) {
  console.log("【预演】将写 " + grid.rows.length + " 行 × " + (grid.rows[0] ? grid.rows[0].values.length : 0) + " 列，不实际写入。");
  console.log(JSON.stringify(grid).slice(0, 400));
  process.exitCode = 0;
} else {
  // 2) 写企微（覆盖 A1 起；表头+全部数据）
  const 写返回 = 取返回载荷(调企微([
    "sheet", "contents", "update",
    "--docid", 配置.docid,
    "--sheet-id", 配置.sheet_id,
    "--grid-data", JSON.stringify(grid)
  ]));
  console.log(`写入企微：errcode=${写返回.errcode}（${写返回.errmsg || "ok"}）`);

  // 3) 回读（csv）逐格核对：每个非空格子的文本都应出现在回读里
  const 读返回 = 取返回载荷(调企微([
    "sheet", "ranges", "get",
    "--docid", 配置.docid,
    "--sheet-id", 配置.sheet_id,
    "--mode", "csv"
  ]));
  const csv = String(读返回.content || "");
  const 缺失 = [];
  for (const 行 of 矩阵) {
    for (const 格 of 行) {
      const 文 = String(格 == null ? "" : 格).trim();
      if (文 && !csv.includes(文)) 缺失.push(文.slice(0, 40));
    }
  }
  console.log(`回读：${csv.split(/\r?\n/).length} 行 CSV；非空格缺失 ${缺失.length} 个${缺失.length ? "：" + JSON.stringify(缺失.slice(0, 5)) : "（全对）"}`);
  if (缺失.length) throw new Error("回读缺格，停手报人");
  console.log("完成。");
}
