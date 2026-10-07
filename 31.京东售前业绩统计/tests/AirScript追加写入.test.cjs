#!/usr/bin/env node
// 31号 · AirScript 追加写入脚本的本地 mock 测试。
// 为什么要它：两个追加脚本只能在金山云上跑，逻辑（表头守卫/末行追加/allowWrite 门/
// expectedLastRow 防重/回读比对）一旦被改坏，线上就是「写错表/重复追加」，本地留一道锁。
// 用法：node tests/AirScript追加写入.test.cjs
const fs = require("node:fs");
const path = require("node:path");

let 通过 = 0;
let 失败 = 0;
function 断言(条件, 名称, 详情 = "") {
  if (条件) { 通过 += 1; console.log(`  ✓ ${名称}`); }
  else { 失败 += 1; console.error(`  ✗ ${名称}${详情 ? " —— " + 详情 : ""}`); }
}

// —— 极简 A1 记法：'A1' / 'A1:N3' / 'E2:E9' ——
function 解析地址(地址) {
  const m = String(地址).match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error(`mock 不认识的地址：${地址}`);
  const 列号 = (字母) => [...字母].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
  return { 起列: 列号(m[1]), 起行: Number(m[2]), 止列: 列号(m[3] || m[1]), 止行: Number(m[4] || m[2]) };
}

// 模拟金山“日期自动解析”：非文本格式的格写入 2026-09 / 2026-09-01 10:00:00 这类串会被存成日期序列号。
// 2026-10-07 线上实锤：管家 B/C/D 没设 '@' → "2026-09" 存成 46266，回读不一致。
function 像日期串(v) {
  return typeof v === "string" && /^\d{4}-\d{2}(-\d{2})?( \d{2}:\d{2}(:\d{2})?)?$/.test(v);
}
function 日期序列(v) {
  const 时间 = v.includes(" ") ? Date.parse(v.replace(" ", "T")) : Date.parse(v.length === 7 ? `${v}-01T00:00:00` : `${v}T00:00:00`);
  return Math.round(时间 / 86400000) + 25569;
}

class FakeSheet {
  constructor(行数 = 4000, 列数 = 20) {
    this.格 = Array.from({ length: 行数 }, () => new Array(列数).fill(""));
    this.格式 = {}; // "行:列" -> 数字格式
  }
  数值(r, c) {
    const v = this.格[r - 1]?.[c - 1];
    if (this.格式[`${r}:${c}`] === "@") return v === undefined ? "" : String(v);
    return v;
  }
  Range(地址) {
    const { 起列, 起行, 止列, 止行 } = 解析地址(地址);
    const 本 = this;
    const 落 = (r, c, v) => {
      if (本.格[r - 1]?.[ c - 1 ] === undefined) return;
      let 存 = v;
      if (本.格式[`${r}:${c}`] !== "@" && 像日期串(v)) 存 = 日期序列(v);
      本.格[r - 1][c - 1] = 存;
    };
    const 写 = (值) => {
      if (值 instanceof Array) 值.forEach((行, i) => (行 instanceof Array ? 行 : [行]).forEach((v, j) => 落(起行 + i, 起列 + j, v)));
      else if (起行 === 止行 && 起列 === 止列) 落(起行, 起列, 值);
      else for (let r = 起行; r <= 止行; r += 1) for (let c = 起列; c <= 止列; c += 1) 落(r, c, 值);
    };
    const 设格式 = (f) => { for (let r = 起行; r <= 止行; r += 1) for (let c = 起列; c <= 止列; c += 1) 本.格式[`${r}:${c}`] = f; };
    return {
      get Value2() {
        if (起行 === 止行 && 起列 === 止列) return 本.数值(起行, 起列);
        const 出 = [];
        for (let r = 起行; r <= 止行; r += 1) { const 行 = []; for (let c = 起列; c <= 止列; c += 1) 行.push(本.数值(r, c)); 出.push(行); }
        return 出;
      },
      set Value2(值) { 写(值); },
      set Value(值) { 写(值); },
      set NumberFormatLocal(f) { 设格式(f); },
      set NumberFormat(f) { 设格式(f); }
    };
  }
}

// 载入 AirScript 正文（用 Function 包一层；文件末尾就是 return main()）。
function 载入脚本(相对路径) {
  const 源码 = fs.readFileSync(path.join(__dirname, "..", 相对路径), "utf8");
  return new Function("Context", "Application", "console", "Date", 源码);
}

const 表头A = ["店铺", "年月", "咨询时间", "下单时间", "商品编号", "商品名称", "客服", "客户", "所属订单编号", "商品单价(?)", "购买数量", "订单状态", "客服", "种菜"];
const 表头B = ["店铺", "年月", "订单编号", "顾客昵称", "订单状态", "下单时间", "付款时间", "出库时间", "订单金额（元）", "客服昵称", "开始时间", "结束时间", "种菜"];

function 造表(表头, 数据行 = []) {
  const 表 = new FakeSheet();
  表头.forEach((v, i) => { 表.格[0][i] = v; });
  数据行.forEach((行, r) => 行.forEach((v, c) => { 表.格[r + 1][c] = v; }));
  return 表;
}
const 建应用 = (工作表) => ({ Worksheets: { Item: (名) => { if (!工作表[名]) throw new Error(`mock 没有工作表 ${名}`); return 工作表[名]; } } });

console.log("== 管家数据-追加写入 ==");
{
  const 表 = 造表(表头A, [["京东1店", "2026-08", "t", "t", "1001", "g", "n", "c", "360", 1, 1, "已完成", "实", ""]]);
  const 跑 = 载入脚本("kdocs-scripts/AirScript-管家数据-追加写入.md");
  const 应用 = 建应用({ 明细: 表 });

  const 探针 = 跑({ argv: { probe: true } }, 应用, console, Date);
  断言(探针.mode === "probe" && 探针.headerOk === true && 探针.lastRow === 2, "探针：表头就位、末行=2", JSON.stringify(探针));
  const 拒写 = 跑({ argv: { rows: [["x"]] } }, 应用, console, Date);
  断言(拒写.written === false && String(拒写.message).includes("allowWrite"), "没 allowWrite 拒绝写");
  const 拒空 = 跑({ argv: { rows: [], allowWrite: true } }, 应用, console, Date);
  断言(拒空.written === false && String(拒空.message).includes("rows 为空"), "rows 为空拒绝写");
  const 拒重 = 跑({ argv: { rows: [["京东1店", "2026-09", "t", "t", "1002", "g", "n", "c", "361", 1, 1, "已完成", "实", ""]], allowWrite: true, expectedLastRow: 99 } }, 应用, console, Date);
  断言(拒重.written === false && String(拒重.message).includes("expectedLastRow"), "expectedLastRow 不符拒绝写");
  const 追加 = 跑({ argv: { rows: [["京东1店", "2026-09", "2026-09-01 10:00:00", "2026-09-01 10:05:00", "1001", "商品", "nick", "cust", "3576448017067420", 398.9, 2, "已完成", "实名", ""]], allowWrite: true, expectedLastRow: 2 } }, 应用, console, Date);
  断言(追加.written === true && 追加.rows === 1 && 追加.firstRow === 3 && 追加.lastRow === 3, "追加 1 行：第 3 行落位", JSON.stringify(追加).slice(0, 300));
  断言(追加.mismatchedRows === 0, "回读比对 0 差异", 追加.firstMismatch);
  断言(表.格[2][8] === "3576448017067420", "16 位订单号未丢精度（文本存储）", String(表.格[2][8]));
  断言(表.格[2][9] === 398.9, "金额保持数值", String(表.格[2][9]));

  const 坏表 = 造表(["店铺", "错误", "咨询时间", "下单时间", "商品编号", "商品名称", "客服", "客户", "所属订单编号", "商品单价(?)", "购买数量", "订单状态", "客服", "种菜"]);
  const 拒表 = 跑({ argv: { rows: [["x"]], allowWrite: true } }, 建应用({ 明细: 坏表 }), console, Date);
  断言(拒表.written === false && String(拒表.message).includes("表头"), "表头不对拒绝写");

  // 跨块写入：250 行 > CHUNK_ROWS(200)，验证分块落地与回读
  const 大数据 = [];
  for (let i = 1; i <= 250; i += 1) 大数据.push(["京东1店", "2026-09", "2026-09-01 10:00:00", "2026-09-01 10:05:00", `1${String(i).padStart(4, "0")}`, "商品", "nick", "cust", `357644801706742${i}`, i, 1, "已完成", "实名", ""]);
  const 大追加 = 跑({ argv: { rows: 大数据, allowWrite: true, expectedLastRow: 3 } }, 应用, console, Date);
  断言(大追加.written === true && 大追加.rows === 250 && 大追加.firstRow === 4 && 大追加.lastRow === 253, "跨块追加 250 行（4~253）", JSON.stringify(大追加).slice(0, 300));
  断言(大追加.mismatchedRows === 0, "跨块回读比对 0 差异", 大追加.firstMismatch);

  // v2：B/C/D 强制文本（防金山日期解析）——年月/时间是原文串，回读 0 差异
  const 文本行 = ["京东1店", "2026-09", "2026-09-01 10:00:00", "2026-09-01 10:05:00", "1002", "商品", "nick", "cust", "3576448017067421", 1, 1, "已完成", "实名", ""];
  const 文本追加 = 跑({ argv: { rows: [文本行], allowWrite: true, expectedLastRow: 253 } }, 应用, console, Date);
  断言(文本追加.written === true && 文本追加.mismatchedRows === 0, "v2：B/C/D 设文本格式，回读 0 差异", 文本追加.firstMismatch);
  断言(表.格[253][1] === "2026-09" && 表.格[253][2] === "2026-09-01 10:00:00" && 表.格[253][3] === "2026-09-01 10:05:00", "v2：年月/咨询/下单时间是文本原文", `${表.格[253][1]} / ${表.格[253][2]}`);

  // v2 repair：把已被日期解析的 3 行（B/C/D 是序列号）重写回文本 + 守卫
  const 修表 = 造表(表头A, []);
  修表.格[1] = ["京东1店", 46266, 46266, 46266, "1001", "商品", "nick", "cust", "3576448017067400", 1, 1, "已完成", "实名", ""];
  修表.格[2] = ["京东1店", 46266, 46266, 46266, "1001", "商品", "nick", "cust", "3576448017067401", 1, 1, "已完成", "实名", ""];
  修表.格[3] = ["京东1店", 46266, 46266, 46266, "1001", "商品", "nick", "cust", "3576448017067402", 1, 1, "已完成", "实名", ""];
  const 修复行 = [
    ["京东1店", "2026-09", "2026-09-01 10:00:00", "2026-09-01 10:05:00", "1001", "商品", "nick", "cust", "3576448017067400", 1, 1, "已完成", "实名", ""],
    ["京东1店", "2026-09", "2026-09-02 10:00:00", "2026-09-02 10:05:00", "1001", "商品", "nick", "cust", "3576448017067401", 1, 1, "已完成", "实名", ""],
    ["京东1店", "2026-09", "2026-09-03 10:00:00", "2026-09-03 10:05:00", "1001", "商品", "nick", "cust", "3576448017067402", 1, 1, "已完成", "实名", ""]
  ];
  const 跑修 = 载入脚本("kdocs-scripts/AirScript-管家数据-追加写入.md");
  const 修应用 = 建应用({ 明细: 修表 });
  const 拒修 = 跑修({ argv: { repair: { startRow: 2, rows: 修复行 } } }, 修应用, console, Date);
  断言(拒修.written === false && String(拒修.message).includes("allowWrite"), "repair 没 allowWrite 拒绝");
  const 超界 = 跑修({ argv: { repair: { startRow: 2, rows: [...修复行, ...修复行] }, allowWrite: true } }, 修应用, console, Date);
  断言(超界.written === false && String(超界.message).includes("超出"), "repair 超出末行拒绝");
  const 错位 = 跑修({ argv: { repair: { startRow: 2, rows: 修复行, expectFirstA: "京东9店" }, allowWrite: true } }, 修应用, console, Date);
  断言(错位.written === false && String(错位.message).includes("expectFirstA"), "repair 首行不符拒绝（防错位）");
  const 修复 = 跑修({ argv: { repair: { startRow: 2, rows: 修复行, expectFirstA: "京东1店" }, allowWrite: true } }, 修应用, console, Date);
  断言(修复.written === true && 修复.rows === 3 && 修复.mismatchedRows === 0, "repair 3 行重写 + 回读 0 差异", JSON.stringify(修复).slice(0, 300));
  断言(修表.格[1][1] === "2026-09" && 修表.格[1][2] === "2026-09-01 10:00:00", "repair 后 B/C 是文本原文", `${修表.格[1][1]} / ${修表.格[1][2]}`);
  断言(修复.firstA === "京东1店", "repair 回执带 firstA", String(修复.firstA));
}

console.log("== 魔方数据-追加写入 ==");
{
  const 表 = 造表(表头B, [["京东3店", "2026-08", "3546459001332484", "j***o", "完成", "t", "t", "t", 398.9, "刘某某", "t", "t", "hash"]]);
  const 跑 = 载入脚本("kdocs-scripts/AirScript-魔方数据-追加写入.md");
  const 应用 = 建应用({ Sheet1: 表 });

  const 探针 = 跑({ argv: { probe: true } }, 应用, console, Date);
  断言(探针.headerOk === true && 探针.lastRow === 2, "探针：表头就位、末行=2", JSON.stringify(探针));
  const 追加 = 跑({ argv: { rows: [["京东3店", "2026-09", "3607474001008523", "s***6", "完成", "2026-09-01 20:54:23", "2026-09-01 20:54:39", "2026-09-01 22:29:06", 993.65, "麦某某", "2026-09-01 20:49:14", "2026-09-01 20:51:17", "abc123"]], allowWrite: true, expectedLastRow: 2 } }, 应用, console, Date);
  断言(追加.written === true && 追加.rows === 1 && 追加.mismatchedRows === 0, "追加 1 行 + 回读 0 差异", JSON.stringify(追加).slice(0, 300));
  断言(表.格[2][2] === "3607474001008523", "16 位订单号未丢精度（文本存储）", String(表.格[2][2]));
  断言(表.格[2][8] === 993.65, "金额保持数值", String(表.格[2][8]));

  // v2：B/F/G/H/K/L 强制文本（防日期解析）
  const 魔方行 = ["京东3店", "2026-09", "3607474001008524", "s***7", "完成", "2026-09-02 20:54:23", "2026-09-02 20:54:39", "2026-09-02 22:29:06", 993.65, "麦某某", "2026-09-02 20:49:14", "2026-09-02 20:51:17", "abc124"];
  const 魔方追加 = 跑({ argv: { rows: [魔方行], allowWrite: true, expectedLastRow: 3 } }, 应用, console, Date);
  断言(魔方追加.written === true && 魔方追加.mismatchedRows === 0, "v2：B/F/G/H/K/L 设文本格式，回读 0 差异", 魔方追加.firstMismatch);
  断言(表.格[3][1] === "2026-09" && 表.格[3][5] === "2026-09-02 20:54:23", "v2：年月/下单时间是文本原文", `${表.格[3][1]} / ${表.格[3][5]}`);

  // v2 repair
  const 魔方修表 = 造表(表头B, []);
  魔方修表.格[1] = ["京东3店", 46266, "3607474001008525", "s***8", "完成", 46266, 46266, 46266, 993.65, "麦某某", 46266, 46266, "abc125"];
  const 魔方修复行 = [["京东3店", "2026-09", "3607474001008525", "s***8", "完成", "2026-09-03 20:54:23", "2026-09-03 20:54:39", "2026-09-03 22:29:06", 993.65, "麦某某", "2026-09-03 20:49:14", "2026-09-03 20:51:17", "abc125"]];
  const 魔方修 = 跑({ argv: { repair: { startRow: 2, rows: 魔方修复行, expectFirstA: "京东3店" }, allowWrite: true } }, 建应用({ Sheet1: 魔方修表 }), console, Date);
  断言(魔方修.written === true && 魔方修.mismatchedRows === 0, "repair 1 行重写 + 回读 0 差异", JSON.stringify(魔方修).slice(0, 200));
  断言(魔方修表.格[1][1] === "2026-09" && 魔方修表.格[1][5] === "2026-09-03 20:54:23", "repair 后 B/F 是文本原文", `${魔方修表.格[1][1]} / ${魔方修表.格[1][5]}`);
}

console.log(`\n结果：通过 ${通过}，失败 ${失败}`);
process.exitCode = 失败 ? 1 : 0;
