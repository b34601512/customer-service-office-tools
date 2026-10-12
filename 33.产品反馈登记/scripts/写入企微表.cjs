#!/usr/bin/env node
// 33号 写入：把「待写数据」追加到企微《产品问题反馈表》(在线表格 sheet)。
// 2026-10-12 起：产品反馈不再写金山（老板定：以后都不用金山文档），直接写企微表。
// docid / sheet_id 在本机 project-config/企微产品问题表.local.json（不入库）；测试可用 --docid/--sheet-id 覆盖。
//
// 用法：
//   node scripts/写入企微表.cjs --数据 runtime/待写数据/<日期>.json          # 正式写（追加 + 回读核对）
//   node scripts/写入企微表.cjs --数据 runtime/待写数据/<日期>.json --预演    # 只读现表、打印将追加内容
// 数据格式（沿用金山时代）：{ "日期": "2026-10-12", "行": [ [ "登记日期", "反馈人", ... 共 9 格 ], ... ] }
// 流程：读现表（CSV，表头守卫 + 末行存证）→ 逐行 rows append → 回读（CSV）逐格核对。
// 失败不自动重试；表头不符/回读缺格就停手报人。
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const 项目根 = path.resolve(__dirname, "..");
const WECOM = "C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js";
const 配置路径 = path.join(项目根, "project-config", "企微产品问题表.local.json");
const 文字列 = ["登记日期", "反馈人", "产品型号", "问题描述", "反馈对象", "反馈日期", "处理进度", "处理结果", "备注"];
// 表头 = 9 个文字列 + 若干「图片N」列（2026-10-12 表里已加到 图片4；图片列由人工贴图，API 不能写图片单元格）
function 表头合规(表头) {
  if (表头.length < 9 || JSON.stringify(表头.slice(0, 9)) !== JSON.stringify(文字列)) return false;
  return 表头.slice(9).every((列) => /^图片\d+$/.test(列));
}

function 解析参数(argv) {
  const 参 = { 数据: "", 预演: false, docid: "", sheetId: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--数据") 参.数据 = argv[++i] || "";
    else if (a === "--预演") 参.预演 = true;
    else if (a === "--docid") 参.docid = argv[++i] || "";
    else if (a === "--sheet-id") 参.sheetId = argv[++i] || "";
  }
  return 参;
}

function 读配置(参) {
  let 配置 = {};
  if (fs.existsSync(配置路径)) 配置 = JSON.parse(fs.readFileSync(配置路径, "utf8"));
  const docid = 参.docid || 配置.docid;
  const sheet_id = 参.sheetId || 配置.sheet_id;
  if (!docid || !sheet_id) {
    throw new Error(`缺少 docid/sheet_id：配 ${path.relative(项目根, 配置路径)}（不入库）或用 --docid/--sheet-id 覆盖`);
  }
  return { docid, sheet_id };
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

function 读现表CSV(配置) {
  const 载荷 = 取返回载荷(调企微([
    "sheet", "ranges", "get", "--docid", 配置.docid, "--sheet-id", 配置.sheet_id, "--mode", "csv"
  ]));
  return String(载荷.content || "");
}

function 非空行(csv) {
  return csv.split(/\r?\n/).filter((行) => 行.trim() !== "");
}

function 行转企微(cells) {
  return {
    values: cells.map((值) => ({ cell_value: { text: String(值 == null ? "" : 值) }, data_type: "TEXT" }))
  };
}

const 参 = 解析参数(process.argv.slice(2));
const 配置 = 读配置(参);

// 读数据文件
const 数据全路径 = path.resolve(项目根, 参.数据 || "");
if (!参.数据 || !fs.existsSync(数据全路径)) throw new Error(`数据文件不存在：${数据全路径}（先备 runtime/待写数据/<日期>.json）`);
const 数据 = JSON.parse(fs.readFileSync(数据全路径, "utf8"));
if (!Array.isArray(数据.行) || !数据.行.length) throw new Error("数据文件没有「行」数组");
for (const 行 of 数据.行) {
  if (!Array.isArray(行) || 行.length !== 9) throw new Error(`每行应为 9 个文字格（登记日期|反馈人|产品型号|问题描述|反馈对象|反馈日期|处理进度|处理结果|备注），实得 ${Array.isArray(行) ? 行.length : "非数组"}`);
}
console.log(`33号 写企微表：${数据.日期 || "(无日期)"}，${数据.行.length} 行；数据文件 ${path.relative(项目根, 数据全路径)}`);

// 1) 读现表：表头守卫 + 末行存证
const 前CSV = 读现表CSV(配置);
const 前非空 = 非空行(前CSV);
const 表头 = (前非空[0] || "").split(",");
if (!表头合规(表头)) {
  throw new Error(`表头与预期不符，停手报人：\n  实际：${JSON.stringify(表头)}\n  预期：前 9 列 ${JSON.stringify(文字列)}，其后只能是「图片N」`);
}
console.log(`现表：${前非空.length} 行（表头+数据），将在第 ${前非空.length + 1} 行起追加 ${数据.行.length} 行`);

// 文字行补齐到表头列数（图片列留空，由人工贴图）
const 补齐 = (行) => [...行, ...Array(表头.length - 9).fill("")];

if (参.预演) {
  for (const 行 of 数据.行) console.log("  [预演] " + 行.map((格) => String(格 == null ? "" : 格).slice(0, 30)).join(" | "));
  console.log("【预演】不实际写入。");
} else {
  // 2) 逐行追加
  for (const 行 of 数据.行) {
    const 返回 = 取返回载荷(调企微([
      "sheet", "rows", "append", "--docid", 配置.docid, "--sheet-id", 配置.sheet_id,
      "--row", JSON.stringify(行转企微(补齐(行)))
    ]));
    console.log(`追加返回：errcode=${返回.errcode}（${返回.errmsg || "ok"}）`);
  }

  // 3) 回读核对：行数 = 前 + 新；每个非空格子文本都在回读里
  const 后CSV = 读现表CSV(配置);
  const 后非空 = 非空行(后CSV);
  const 应有行数 = 前非空.length + 数据.行.length;
  if (后非空.length !== 应有行数) throw new Error(`回读行数不符：现有 ${后非空.length}，应有 ${应有行数}`);
  const 缺失 = [];
  for (const 行 of 数据.行) {
    for (const 格 of 行) {
      const 文 = String(格 == null ? "" : 格).trim();
      if (文 && !后CSV.includes(文)) 缺失.push(文.slice(0, 40));
    }
  }
  if (缺失.length) throw new Error(`回读缺格，停手报人：${JSON.stringify(缺失.slice(0, 5))}`);
  console.log(`回读：${后非空.length} 行（应为 ${应有行数}），新增格全对 ✓`);
  console.log("完成。");
}
