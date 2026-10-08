#!/usr/bin/env node
// 32号《补差-写数据》回归测试（2026-10-08 拆分 v6 后新脚本 ①）：
//   ① AirScript 正文按 Node 函数加载，用内存假表验证：探针只读、无 allowWrite 零写入、
//      写汇总/写主体的 表头守卫 + 末行守卫 + 回读逐格比对、宿主数组兼容；
//   ② 【2026-10-08 新修】日期列：文本日期入参 → 落格是**日期序列号** + 显式日期格式 yyyy/m/d；
//      长数字列（账号/订单号/转账单号）仍先设 '@' 文本格式；N(申请日期) 不再被当成文本列；
//   ③ 回读比对：日期串与序列号视作同值（v4 的 日期序()/同值()）；
//   ④ 本地客户端：载荷形状（含 allowWrite）、数据文件守卫、任一步失败即停、反向断言
//      （只回 status:'已写入' 无 written:true 必判失败）。
// 跑：node tests/补差-写数据.test.cjs
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const 项目根 = path.resolve(__dirname, "..");
const 脚本路径 = path.join(项目根, "kdocs-scripts", "AirScript-补差-写数据.md");
const 客户端 = require(path.join(项目根, "scripts", "补差-写数据.cjs"));

let 通过 = 0;
let 失败 = 0;
function 断言(条件, 说明, 实测 = "") {
  if (条件) { 通过 += 1; console.log(`  ✓ ${说明}`); }
  else { 失败 += 1; console.log(`  ✗ ${说明}${实测 ? `｜实测：${实测}` : ""}`); }
}
function 深等于(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const 汇总表头 = ["购买日期", "姓名", "支付宝/微信账号", "店铺", "订单编号", "产品", "费用类型", "金额", "处理时间", "转账单号", "原因", "费用责任部门", "主体", "申请日期", "客户反馈\n故障现象", "品质工程师\n确认结果", "维修内容及更换配件", "责任归属"];
const 主体表头 = ["姓名", "收款方式", "店铺", "订单编号", "型号", "类型", "金额", "处理时间", "转账单号", "原因简述", "责任部门", "责任人"];
const 集团名 = "深圳市德达医疗科技集团有限公司";
const 器械名 = "深圳市德达医疗器械有限公司";

function 列号(字母) {
  let n = 0;
  for (const ch of 字母) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}
function 列名(n) { return String.fromCharCode(64 + n); }

// 内存假表：Range/Cells 的 Value2/Formula/NumberFormat(含 Local)/ClearContents；记录全部写入事件。
function 造假表(名, 选项 = {}) {
  const 值 = new Map();
  const 公式 = new Map();
  const 格式 = new Map();
  const 记录 = { 值写入: [], 格式事件: [], 清空: [], 公式写入: [] };
  const 键 = (r, c) => r + "," + c;
  for (const [地址, v] of Object.entries(选项.初始 || {})) {
    const m = /^([A-Z]+)(\d+)$/.exec(地址);
    if (m) 值.set(键(Number(m[2]), 列号(m[1])), v);
  }
  function 解析地址(地址) {
    let m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(地址);
    if (m) return { r1: Number(m[2]), c1: 列号(m[1]), r2: Number(m[4]), c2: 列号(m[3]) };
    m = /^([A-Z]+)(\d+)$/.exec(地址);
    if (m) return { r1: Number(m[2]), c1: 列号(m[1]), r2: Number(m[2]), c2: 列号(m[1]) };
    throw new Error("假表不认识的地址：" + 地址);
  }
  function 建单格(r, c) {
    return {
      get Value2() { return 值.get(键(r, c)) === undefined ? "" : 值.get(键(r, c)); },
      set Value2(v) { 值.set(键(r, c), v); },
      get Formula() { return 公式.get(键(r, c)) || ""; },
      set Formula(f) { 公式.set(键(r, c), String(f)); 记录.公式写入.push({ 地址: 列名(c) + r, 公式: String(f) }); },
      get NumberFormat() { return 格式.get(键(r, c)) || ""; },
      set NumberFormat(f) { 格式.set(键(r, c), String(f)); 记录.格式事件.push({ 地址: 列名(c) + r, 格式: String(f) }); },
      set NumberFormatLocal(f) { 格式.set(键(r, c), String(f)); 记录.格式事件.push({ 地址: 列名(c) + r, 格式: String(f) }); }
    };
  }
  const 表 = {
    Name: 名,
    Cells: (r, c) => 建单格(r, c),
    Range(地址) {
      const a = 解析地址(地址);
      return {
        get Value2() {
          const 出 = [];
          for (let r = a.r1; r <= a.r2; r += 1) {
            const 行 = [];
            for (let c = a.c1; c <= a.c2; c += 1) 行.push(值.get(键(r, c)) === undefined ? "" : 值.get(键(r, c)));
            出.push(行);
          }
          return 出;
        },
        set Value2(v) {
          记录.值写入.push({ 地址, 值: v });
          for (let r = a.r1; r <= a.r2; r += 1) {
            const 源行 = v[r - a.r1];
            for (let c = a.c1; c <= a.c2; c += 1) {
              let 项 = "";
              if (Array.isArray(源行)) 项 = 源行[c - a.c1];
              else if (a.c1 === a.c2) 项 = 源行;
              值.set(键(r, c), 项 === undefined || 项 === null ? "" : 项);
            }
          }
        },
        get Formula() { return 建单格(a.r1, a.c1).Formula; },
        set Formula(f) { 建单格(a.r1, a.c1).Formula = f; },
        get NumberFormat() { return 建单格(a.r1, a.c1).NumberFormat; },
        set NumberFormat(f) {
          for (let r = a.r1; r <= a.r2; r += 1) for (let c = a.c1; c <= a.c2; c += 1) {
            格式.set(键(r, c), String(f));
            记录.格式事件.push({ 地址: 列名(c) + r, 格式: String(f) });
          }
        },
        set NumberFormatLocal(f) {
          for (let r = a.r1; r <= a.r2; r += 1) for (let c = a.c1; c <= a.c2; c += 1) {
            格式.set(键(r, c), String(f));
            记录.格式事件.push({ 地址: 列名(c) + r, 格式: String(f) });
          }
        },
        ClearContents() {
          记录.清空.push(地址);
          for (let r = a.r1; r <= a.r2; r += 1) for (let c = a.c1; c <= a.c2; c += 1) { 值.delete(键(r, c)); 公式.delete(键(r, c)); }
        },
        get PivotTable() { return null; }
      };
    }
  };
  return { 表, 记录, 值, 公式, 格式 };
}

// 假 Application：Worksheets.Item(名/序号)/Count
function 造应用(表们) {
  return {
    Worksheets: {
      get Count() { return 表们.length; },
      Item(键) {
        if (typeof 键 === "number") {
          if (!表们[键 - 1]) throw new Error("假表：没有第 " + 键 + " 个表");
          return 表们[键 - 1];
        }
        const 找 = 表们.find((t) => t.Name === 键);
        if (!找) throw new Error("假表：没有「" + 键 + "」");
        return 找;
      }
    }
  };
}

// 三张表：汇总（表头 1 行 + 数据到 汇末）、集团/器械（表头第 3 行 + 数据 4 起）
function 造三表(选项 = {}) {
  const 汇末 = 选项.汇末 === undefined ? 1672 : 选项.汇末;
  const 集末 = 选项.集末 === undefined ? 19 : 选项.集末;
  const 械末 = 选项.械末 === undefined ? 12 : 选项.械末;
  const 汇总 = 造假表("汇总");
  汇总表头.forEach((v, i) => 汇总.值.set("1," + (i + 1), v));
  汇总.值.set(汇末 + ",1", "2026/9/3");
  汇总.值.set(汇末 + ",14", 46268);
  const 造主体 = (名, 末) => {
    const t = 造假表(名);
    主体表头.forEach((v, i) => t.值.set("3," + (i + 1), v));
    for (let r = 4; r <= 末; r += 1) { t.值.set(r + ",1", "旧" + r); t.值.set(r + ",8", "交易成功"); }
    return t;
  };
  const 集团 = 造主体(集团名, 集末);
  const 器械 = 造主体(器械名, 械末);
  return { 汇总, 集团, 器械, app: 造应用([汇总.表, 集团.表, 器械.表]) };
}

// AirScript 正文当 Node 函数加载（末尾 return main() 换成导出内部函数）
function 实例化(宿主 = {}) {
  let 源码 = fs.readFileSync(脚本路径, "utf8");
  const 尾 = 源码.lastIndexOf("return main()");
  if (尾 < 0) throw new Error("脚本末尾没有 return main()，加载失败");
  源码 = 源码.slice(0, 尾);
  const 工厂 = new Function(
    "Context", "Application",
    源码 + "\nreturn { scriptVersion, 汇总日期列, 主体日期列, 日期格式, 汇总文本列, 主体文本列, 是数组, 转净数组, 转对象, 日期序, 同值, 对比块, 装日期值, 归一日期列, 执行探针, 执行预演, 执行写汇总, 执行写主体, 解析参数, 主函数: main };"
  );
  return 工厂(宿主.Context, 宿主.Application);
}

function 宿主数组(字面量) { return vm.runInNewContext(`(${字面量})`); }

async function 该抛错(fn) {
  try { await fn(); return { 抛了: false, 消息: "" }; }
  catch (e) { return { 抛了: true, 消息: String((e && e.message) || e) }; }
}

// 18 列样例汇总行：A 购买日期、N 申请日期都给文本日期；C/E/J 是长数字
function 样例汇总行() {
  return ["2023/2/28", "王家涛", "6230880020019354729", "京东6店", "260318751676", "Q5L", "返运费", "122",
    "交易成功", "20260914200040011100080038261237", "保内维修运费", "怀化工厂", 集团名, "2026/10/8", "", "", "", ""];
}
function 样例主体行() {
  return ["王家涛", "6230880020019354729", "京东6店", "260318751676", "Q5L", "返运费", "122",
    "2026/9/14", "20260914200040011100080038261237", "保内维修运费", "怀化工厂", ""];
}
function 数据文件(覆盖 = {}) {
  return {
    月份: "2026-09",
    预期末行: { 汇总: 1672, 集团: 19, 器械: 12 },
    汇总行: [样例汇总行()],
    主体: {
      [集团名]: { 行: [样例主体行()] },
      [器械名]: { 行: [样例主体行()] }
    },
    ...覆盖
  };
}

async function 主() {
  console.log("\n  32号《补差-写数据》回归测试（拆分 v6 后新脚本 ①）\n");

  // ── 1) 脚本版本 + 粘贴安全 ────────────────────────────────────────────────
  {
    const s = 实例化({ Application: 造应用([]) });
    断言(s.scriptVersion === "2026-10-08.1", "脚本版本 2026-10-08.1", s.scriptVersion);
    const 源码 = fs.readFileSync(脚本路径, "utf8");
    断言(!源码.includes("==") && !源码.includes("!==") && !源码.includes("==="), "源码里没有连续两个等号（粘贴安全）");
    断言(源码.trimEnd().endsWith("return main()"), "末行是顶层 return main()");
    断言(s.汇总日期列.join(",") === "1,14" && s.主体日期列.join(",") === "8", "日期列 = 汇总 A/N + 主体 H", JSON.stringify({ 汇: s.汇总日期列, 主: s.主体日期列 }));
    断言(s.日期格式 === "yyyy/m/d", "日期格式 = yyyy/m/d", s.日期格式);
    断言(!s.汇总文本列.includes(14), "汇总文本列不含 N(申请日期)（v6 的根因）", JSON.stringify(s.汇总文本列));
  }

  // ── 2) 转净数组：宿主数组 / JSON 字符串 / 原生 ─────────────────────────────
  {
    const s = 实例化({ Application: 造应用([]) });
    const 宿主 = 宿主数组('[["甲","=DISPIMG(\\"ID_1\\",1)"],["乙","x"]]');
    断言(!(宿主 instanceof Array), "（前提）vm 宿主数组 instanceof Array 为 false");
    断言(s.是数组(宿主) && !s.是数组("abc"), "是数组：宿主 true / 字符串 false");
    const 净 = s.转净数组(宿主);
    断言(净 instanceof Array && 净.every((r) => r instanceof Array) && 深等于(JSON.parse(JSON.stringify(净)), [["甲", '=DISPIMG("ID_1",1)'], ["乙", "x"]]),
      "转净数组(宿主数组) → 全原生且内容一致");
    断言(深等于(s.转净数组(JSON.stringify([["a", "b"]])), [["a", "b"]]), "转净数组(JSON 字符串) 可用");
    断言(s.转净数组("不是JSON").length === 0, "转净数组(坏字符串) → []");
  }

  // ── 3) 无 allowWrite 一个字节不写（写汇总 / 写主体 都试）────────────────────
  {
    const 表组 = 造三表();
    const s = 实例化({ Context: { argv: { action: "写汇总", 汇总行: JSON.stringify([样例汇总行()]) } }, Application: 表组.app });
    const 报 = s.主函数();
    断言(报.written === false && String(报.message).includes("allowWrite"), "main(写汇总 无 allowWrite) → 拒绝", JSON.stringify(报).slice(0, 160));
    断言(表组.汇总.记录.值写入.length === 0 && 表组.汇总.记录.格式事件.length === 0, "无 allowWrite：汇总零写入/零格式改动");
    const 表组2 = 造三表();
    const s2 = 实例化({ Context: { argv: { action: "写主体", 集团行: JSON.stringify([样例主体行()]), 器械行: JSON.stringify([样例主体行()]) } }, Application: 表组2.app });
    const 报2 = s2.主函数();
    断言(报2.written === false && 表组2.集团.记录.清空.length === 0 && 表组2.器械.记录.值写入.length === 0, "无 allowWrite：写主体也零写入（不清不写）");
  }

  // ── 4) 写汇总守护：缺行 / 表头不对 / 末行不对 ──────────────────────────────
  {
    const s = 实例化({ Application: 造应用([]) });
    断言(s.执行写汇总({ 汇总行: [] }).message === "没有汇总行", "写汇总：缺行 → 拒绝");
    const 表组 = 造三表();
    表组.汇总.值.set("1,1", "购买日期改坏了");
    const 报 = 实例化({ Application: 表组.app }).执行写汇总({ 汇总行: JSON.stringify([样例汇总行()]), 预期末行: 1672 });
    断言(报.written === false && String(报.message).includes("表头不对"), "写汇总：表头不对 → 拒绝", JSON.stringify(报).slice(0, 200));
    断言(表组.汇总.记录.值写入.length === 0, "写汇总：表头不对 → 一个字节不写");
    const 表组2 = 造三表();
    const 报2 = 实例化({ Application: 表组2.app }).执行写汇总({ 汇总行: JSON.stringify([样例汇总行()]), 预期末行: 1600 });
    断言(报2.written === false && String(报2.message).includes("末行"), "写汇总：末行与预期不符 → 拒绝", JSON.stringify(报2).slice(0, 200));
    断言(表组2.汇总.记录.值写入.length === 0, "写汇总：末行不符 → 一个字节不写");
  }

  // ── 5) 写汇总 happy：日期串 → 序列号 + 日期格式；长数字列 '@'；回读 0 差异 ──
  {
    const 表组 = 造三表();
    const s = 实例化({ Application: 表组.app });
    const 报 = s.执行写汇总({ 汇总行: JSON.stringify([样例汇总行()]), 预期末行: 1672 });
    断言(报.written === true && 报.回读差异数 === 0 && 报.首行 === 1673 && 报.写入行数 === 1, "写汇总：写入 1 行、回读 0 差异", JSON.stringify(报).slice(0, 240));
    断言(表组.汇总.值.get("1673,1") === 44985 && typeof 表组.汇总.值.get("1673,1") === "number", "日期 A 落格 = 序列号 44985（不是文本 '2023/2/28'）", String(表组.汇总.值.get("1673,1")));
    断言(表组.汇总.值.get("1673,14") === 46303 && typeof 表组.汇总.值.get("1673,14") === "number", "日期 N 落格 = 序列号 46303（申请日期不再是文本）", String(表组.汇总.值.get("1673,14")));
    const 格式事件 = 表组.汇总.记录.格式事件;
    const 取最后 = (地址) => { const 命中 = 格式事件.filter((e) => e.地址 === 地址); return 命中.length ? 命中[命中.length - 1].格式 : ""; };
    断言(取最后("A1673") === "yyyy/m/d" && 取最后("N1673") === "yyyy/m/d", "日期列显式设 yyyy/m/d（NumberFormat 最后落值）", JSON.stringify({ A: 取最后("A1673"), N: 取最后("N1673") }));
    断言(取最后("C1673") === "@" && 取最后("E1673") === "@" && 取最后("J1673") === "@", "长数字列 C/E/J 设 '@' 文本格式", JSON.stringify({ C: 取最后("C1673"), E: 取最后("E1673"), J: 取最后("J1673") }));
    断言(格式事件.filter((e) => e.地址 === "N1673" && e.格式 === "@").length === 0, "N(申请日期) 从没被设成 '@'（v6 根因的反向断言）");
    // 宿主数组（跨 realm）也能写
    const 表组2 = 造三表();
    const s2 = 实例化({ Application: 表组2.app });
    const 报2 = s2.执行写汇总({ 汇总行: 宿主数组(JSON.stringify([样例汇总行()])), 预期末行: 1672 });
    断言(报2.written === true && 报2.回读差异数 === 0, "写汇总：宿主数组（跨 realm）也写入成功");
    const 表组3 = 造三表();
    const s3 = 实例化({ Application: 表组3.app });
    const 汇行2 = [样例汇总行().slice(), 样例汇总行().slice()];
    汇行2[1][0] = "2026/10/8";
    const 报3 = s3.执行写汇总({ 汇总行: JSON.stringify(汇行2), 预期末行: 1672 });
    断言(报3.written === true && 报3.写入行数 === 2 && 表组3.汇总.值.get("1674,1") === 46303, "写汇总：2 行日期串都归一（第 2 行 A = 46303）", String(表组3.汇总.值.get("1674,1")));
  }

  // ── 6) 写主体 happy：清旧行 + 日期 H 归一 + 文本列 '@' + 回读 0 差异 ─────────
  {
    const 表组 = 造三表();
    const s = 实例化({ Application: 表组.app });
    const 报 = s.执行写主体({ 集团行: JSON.stringify([样例主体行()]), 器械行: JSON.stringify([样例主体行(), 样例主体行()]), 预期: { 集团: 19, 器械: 12 } });
    断言(报.集团.written === true && 报.集团.回读差异数 === 0 && 报.集团.写入行数 === 1 && 报.集团.清除到 === 19, "写主体(集团)：写 1 行、清到 19、回读 0 差异", JSON.stringify(报.集团).slice(0, 240));
    断言(报.器械.written === true && 报.器械.写入行数 === 2 && 报.器械.回读差异数 === 0, "写主体(器械)：写 2 行、回读 0 差异");
    断言(表组.集团.记录.清空.includes("A4:P19") && 表组.器械.记录.清空.includes("A4:P12"), "写主体：先 ClearContents A4:P{旧末行}（含 M~P 怀化历史）");
    断言(表组.集团.值.get("4,8") === 46279 && typeof 表组.集团.值.get("4,8") === "number", "主体 H 日期串 2026/9/14 → 序列号 46279", String(表组.集团.值.get("4,8")));
    const 格式事件 = 表组.集团.记录.格式事件;
    const 取最后 = (地址) => { const 命中 = 格式事件.filter((e) => e.地址 === 地址); return 命中.length ? 命中[命中.length - 1].格式 : ""; };
    断言(取最后("H4") === "yyyy/m/d", "主体 H 显式设 yyyy/m/d", 取最后("H4"));
    断言(取最后("B4") === "@" && 取最后("D4") === "@" && 取最后("I4") === "@", "主体长数字列 B/D/I 设 '@'");
    断言(表组.集团.值.get("20,1") === undefined || 表组.集团.值.get("20,1") === "", "写主体：旧第 20 行（超出新数据）已被清空");
  }

  // ── 7) 写主体守护：缺行 / 表头不对 / 末行不对 → 零写入 ──────────────────────
  {
    const s = 实例化({ Application: 造应用([]) });
    const 缺 = s.执行写主体({ 集团行: [], 器械行: JSON.stringify([样例主体行()]), 预期: {} });
    断言(缺.message === "缺 集团行/器械行" && 缺.入参形态 && 缺.入参形态.集团, "写主体：缺集团行 → 拒绝 + 回入参形态");
    const 表组 = 造三表();
    表组.集团.值.set("3,1", "姓名改坏");
    const 报 = 实例化({ Application: 表组.app }).执行写主体({ 集团行: JSON.stringify([样例主体行()]), 器械行: JSON.stringify([样例主体行()]), 预期: { 集团: 19, 器械: 12 } });
    断言(报.集团.written === false && String(报.集团.message).includes("表头不对") && 表组.集团.记录.清空.length === 0, "写主体：表头不对 → 拒绝且不清旧行");
    const 表组2 = 造三表();
    const 报2 = 实例化({ Application: 表组2.app }).执行写主体({ 集团行: JSON.stringify([样例主体行()]), 器械行: JSON.stringify([样例主体行()]), 预期: { 集团: 18, 器械: 12 } });
    断言(报2.集团.written === false && String(报2.集团.message).includes("末行") && 表组2.集团.记录.清空.length === 0, "写主体：集团末行不符 → 拒绝且不清旧行（器械也还没动？按顺序集团先失败即停）");
  }

  // ── 8) 预演：末行+表头守卫 ─────────────────────────────────────────────────
  {
    const 表组 = 造三表();
    const s = 实例化({ Application: 表组.app });
    const 好 = s.执行预演({ 汇总预期末行: 1672, 集团预期末行: 19, 器械预期末行: 12 });
    断言(好.汇总.通过 && 好.集团.通过 && 好.器械.通过 && !好.汇总.表头差异.length, "预演：三表末行对上 + 表头无差异");
    const 坏 = s.执行预演({ 汇总预期末行: 1600, 集团预期末行: 19, 器械预期末行: 12 });
    断言(坏.汇总.通过 === false, "预演：末行不符 → 汇总.通过 false");
    断言(坏.器械.通过 === true, "预演：只报不符的表（器械仍通过）");
    const 探 = s.执行探针();
    断言(探.模式 === "探针" && 探.汇总.末行 === 1672 && 探.集团.数据末行 === 19 && 探.器械.数据末行 === 12, "探针：只读回报三表末行");
    断言(表组.汇总.记录.值写入.length === 0 && 表组.集团.记录.清空.length === 0, "探针：零写入（只读）");
  }

  // ── 9) 日期归一/同值：日期串与序列号视作同值（v4 逻辑不回归）────────────────
  {
    const s = 实例化({ Application: 造应用([]) });
    断言(s.日期序("2023/2/28") === 44985 && s.日期序("44985") === 44985 && Number.isNaN(s.日期序("交易成功")), "日期序：日期串/序列号/非日期各归位");
    断言(s.同值("44985", "2023/2/28") && s.同值(46303, "2026/10/8") && !s.同值("44986", "2023/2/28"), "同值：日期串 ↔ 序列号 同值、差一天不同值");
    断言(s.对比块([["2023/2/28", "122"]], [["44985", "122"]], 2).length === 0, "对比块：日期串期望 vs 序列号实际 = 0 差异");
    断言(深等于(s.归一日期列([["2026/10/8", "交易成功", "122"]], [1, 8]), [[46303, "交易成功", "122"]]), "归一日期列：只动日期列、文本原样保留", JSON.stringify(s.归一日期列([["2026/10/8", "交易成功", "122"]], [1, 8])));
    断言(s.装日期值("") === "" && s.装日期值("交易成功") === "交易成功", "装日期值：空值/非日期串原样返回");
  }

  // ── 10) 客户端：载荷形状 + 数据文件守卫 ─────────────────────────────────────
  {
    const 数据 = 数据文件();
    断言(深等于(客户端.造预演载荷(数据), { action: "预演", 汇总预期末行: 1672, 集团预期末行: 19, 器械预期末行: 12 }), "载荷(预演)：三个预期末行数字");
    const 汇 = 客户端.造写汇总载荷(数据);
    断言(汇.action === "写汇总" && 汇.预期末行 === 1672 && 汇.allowWrite === true && typeof 汇.汇总行 === "string" && 深等于(JSON.parse(汇.汇总行), 数据.汇总行), "载荷(写汇总)：JSON 字符串行 + 预期末行 + allowWrite:true");
    const 主 = 客户端.造写主体载荷(数据);
    断言(主.action === "写主体" && 主.allowWrite === true && 深等于(主.预期, { 集团: 19, 器械: 12 }) && typeof 主.集团行 === "string" && typeof 主.器械行 === "string", "载荷(写主体)：两表 JSON 字符串 + 预期对象 + allowWrite:true");

    const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), "32-xieshuju-"));
    const 好文件 = path.join(临时, "好.json");
    fs.writeFileSync(好文件, JSON.stringify(数据), "utf8");
    const 读 = 客户端.读数据文件(好文件);
    断言(读.预期.汇总 === 1672 && 读.数据.行数 === undefined, "读数据文件：预期末行可用");
    const 坏文件 = path.join(临时, "坏.json");
    fs.writeFileSync(坏文件, JSON.stringify({ 月份: "2026-09" }), "utf8");
    const 坏 = await 该抛错(() => 客户端.读数据文件(坏文件));
    断言(坏.抛了 && 坏.消息.includes("预期末行"), "读数据文件：缺预期末行 → 抛错", 坏.消息);
  }

  // ── 11) 客户端：跑(写数据) happy / 失败即停 / 反向断言 ──────────────────────
  {
    const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), "32-xieshuju-run-"));
    const 数据文件路径 = path.join(临时, "数据.json");
    fs.writeFileSync(数据文件路径, JSON.stringify(数据文件()), "utf8");
    const 证据目录 = path.join(临时, "证据");
    const 好汇 = { written: true, 回读差异数: 0, 写入行数: 1, 首行: 1673, 末行: 1673 };
    const 好主 = { 集团: { written: true, 回读差异数: 0, 写入行数: 1, 清除到: 19 }, 器械: { written: true, 回读差异数: 0, 写入行数: 1, 清除到: 12 } };

    {
      const 调用 = [];
      const 跑 = await 客户端.跑({ 模式: "写数据", 数据: 数据文件路径 }, {
        调脚本: async (argv) => { 调用.push(argv); return argv.action === "写汇总" ? 好汇 : 好主; },
        证据目录
      });
      断言(调用.length === 2 && 调用[0].action === "写汇总" && 调用[1].action === "写主体", "跑(写数据)：先写汇总、再写主体，各一次");
      断言(fs.existsSync(path.join(证据目录, "3-写汇总.json")) && fs.existsSync(path.join(证据目录, "4-写主体.json")), "跑(写数据)：证据 3-写汇总 / 4-写主体 落盘");
      断言(跑.汇.written && 跑.主.集团.written, "跑(写数据)：两个响应都过 written+回读检查");
    }
    {
      const 调用 = [];
      const 坏 = await 该抛错(() => 客户端.跑({ 模式: "写数据", 数据: 数据文件路径 }, {
        调脚本: async (argv) => { 调用.push(argv); return { written: false, message: "末行不对" }; },
        证据目录
      }));
      断言(坏.抛了 && 调用.length === 1, "跑(写数据)：写汇总失败 → 立即停手，不调写主体（不重试）");
    }
    {
      const 调用 = [];
      const 坏 = await 该抛错(() => 客户端.跑({ 模式: "写数据", 数据: 数据文件路径 }, {
        调脚本: async (argv) => { 调用.push(argv); return { written: true, 回读差异数: 2, 差异样例: [{ 行: 1, 列: 1 }] }; },
        证据目录
      }));
      断言(坏.抛了 && 调用.length === 1 && 坏.消息.includes("回读"), "跑(写数据)：回读差异 > 0 → 判失败并停手", 坏.消息);
    }
    {
      const 坏 = await 该抛错(() => 客户端.跑({ 模式: "写数据", 数据: 数据文件路径 }, {
        调脚本: async () => ({ status: "已写入" }),
        证据目录
      }));
      断言(坏.抛了 && 坏.消息.includes("written:true"), "反向断言：只回 status:'已写入' 没有 written:true → 必判失败", 坏.消息);
    }
    {
      const 调用 = [];
      const 预 = await 客户端.跑({ 模式: "预演", 数据: 数据文件路径 }, {
        调脚本: async (argv) => { 调用.push(argv); return { 汇总: { 通过: true, 表头差异: [] }, 集团: { 通过: true, 表头差异: [] }, 器械: { 通过: true, 表头差异: [] } }; },
        证据目录
      });
      断言(调用[0].action === "预演" && 预.结果.汇总.通过, "跑(预演)：调 action=预演 且通过");
      const 坏 = await 该抛错(() => 客户端.跑({ 模式: "预演", 数据: 数据文件路径 }, {
        调脚本: async () => ({ 汇总: { 通过: false, 表头差异: ["C1"] }, 集团: { 通过: true, 表头差异: [] }, 器械: { 通过: true, 表头差异: [] } }),
        证据目录
      }));
      断言(坏.抛了 && 坏.消息.includes("预演不通过"), "跑(预演)：守卫不过 → 抛错停手", 坏.消息);
    }
    {
      const 探 = await 客户端.跑({ 模式: "探针" }, { 调脚本: async (argv) => ({ action: argv.action }), 证据目录 });
      断言(探.结果.action === "探针", "跑(探针)：调 action=探针");
    }
    {
      const 调用 = [];
      await 客户端.跑({ 模式: "写数据", 数据: 数据文件路径 }, {
        调脚本: async (argv) => { 调用.push(argv); return argv.action === "写汇总" ? 好汇 : 好主; },
        证据目录: path.join(临时, "证据2")
      });
      const [只写汇总] = 调用;
      断言(只写汇总.allowWrite === true && typeof 只写汇总.汇总行 === "string" && 只写汇总.预期末行 === 1672, "跑(写数据)：实际请求体形状 = 写汇总载荷", JSON.stringify(只写汇总).slice(0, 120));
    }
  }

  console.log(`\n  结果：通过 ${通过} / 失败 ${失败}\n`);
  if (失败) process.exitCode = 1;
}

主().catch((错误) => {
  console.error(`\n  测试自己炸了：${错误 && 错误.stack ? 错误.stack : 错误}\n`);
  process.exitCode = 1;
});
