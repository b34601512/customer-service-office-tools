#!/usr/bin/env node
// 32号《店铺-主体对照》子表回归测试（2026-10-08）：
//   ① AirScript 正文按 Node 函数加载，用内存假表验证：探针只读、无 allowWrite 零写入、
//      刷对照建表/写表/清旧行/表头守卫/回读比对、读对照、宿主数组兼容；
//   ② 本地客户端：行列表构建（42 条对照 + 20 历史 = 62 行、5 列、白名单、冲突备注）、
//      守卫（列数/白名单/是-否/重复）、payload 形状、--预演 不调 webhook；
//   ③ 反向断言：服务端只回 status:'已写入' 没有 written:true → 客户端必判失败；
//      脚本源码里不出现连续两个等号（粘贴安全）；脚本只出现『店铺-主体对照』一个工作表名。
// 跑：node tests/店铺主体对照.test.cjs
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const 项目根 = path.resolve(__dirname, "..");
const 脚本路径 = path.join(项目根, "kdocs-scripts", "AirScript-补差-店铺主体对照.md");
const 客户端 = require(path.join(项目根, "scripts", "店铺主体对照.cjs"));

let 通过 = 0;
let 失败 = 0;
function 断言(条件, 说明, 实测 = "") {
  if (条件) { 通过 += 1; console.log(`  ✓ ${说明}`); }
  else { 失败 += 1; console.log(`  ✗ ${说明}${实测 ? `｜实测：${实测}` : ""}`); }
}
function 深等于(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function 列号(字母) {
  let n = 0;
  for (const ch of 字母) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

// 内存假表：只实现脚本用到的 Range(地址).Value2 读/写、ClearContents、Name
function 造内存表(名, 记录) {
  const 格 = new Map(); // "行,列"（1 基）→ 文本
  function 解析地址(地址) {
    let m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(地址);
    if (m) return { r1: Number(m[2]), c1: 列号(m[1]), r2: Number(m[4]), c2: 列号(m[3]) };
    m = /^([A-Z]+)(\d+)$/.exec(地址);
    if (m) return { r1: Number(m[2]), c1: 列号(m[1]), r2: Number(m[2]), c2: 列号(m[1]) };
    throw new Error("假表不认识的地址：" + 地址);
  }
  const 表 = {
    Name: 名,
    Range(地址) {
      const a = 解析地址(地址);
      return {
        get Value2() {
          const 出 = [];
          for (let r = a.r1; r <= a.r2; r += 1) {
            const 行 = [];
            for (let c = a.c1; c <= a.c2; c += 1) 行.push(格.get(r + "," + c) || "");
            出.push(行);
          }
          return 出;
        },
        set Value2(v) {
          for (let r = a.r1; r <= a.r2; r += 1) {
            const 源行 = v[r - a.r1];
            const 行 = 源行 instanceof Array ? 源行 : [源行];
            for (let c = a.c1; c <= a.c2; c += 1) {
              const 值 = 行[c - a.c1];
              格.set(r + "," + c, 值 === undefined || 值 === null ? "" : String(值));
            }
          }
        },
        ClearContents() {
          记录.清空.push({ 表: 名, 地址 });
          for (let r = a.r1; r <= a.r2; r += 1) {
            for (let c = a.c1; c <= a.c2; c += 1) 格.delete(r + "," + c);
          }
        },
        get NumberFormat() { return ""; },
        set NumberFormat(_f) {}
      };
    },
    Cells(r, c) {
      return { get Value2() { return 格.get(r + "," + c) || ""; } };
    }
  };
  return 表;
}

// 假 Application：Worksheets.Item(名/序号)、Sheets.Add、Worksheets.Add（可关掉 Sheets 测兜底）
function 造应用(选项 = {}) {
  const 记录 = { Add调用: [], 清空: [] };
  const 表们 = [];
  const 集合 = {
    get Count() { return 表们.length; },
    Item(键) {
      if (typeof 键 === "number") {
        if (!表们[键 - 1]) throw new Error("假表：没有第 " + 键 + " 个表");
        return 表们[键 - 1];
      }
      const 找 = 表们.find((t) => t.Name === 键);
      if (!找) throw new Error("假表：没有「" + 键 + "」");
      return 找;
    },
    Add(...参数) {
      记录.Add调用.push({ via: "Worksheets", 参数 });
      const t = 造内存表("工作表" + (表们.length + 1), 记录);
      表们.push(t);
      return t;
    }
  };
  const app = { Worksheets: 集合, Enum: { XlSheetType: { xlWorksheet: "xlWorksheet" } } };
  if (!选项.没有Sheets) {
    app.Sheets = {
      Add(...参数) {
        // 脚本按 (Before, After, Count, Type, Name) 调
        记录.Add调用.push({ via: "Sheets", 参数 });
        const 名 = typeof 参数[4] === "string" ? 参数[4] : "工作表" + (表们.length + 1);
        const t = 造内存表(名, 记录);
        表们.push(t);
        return t;
      }
    };
  }
  for (const [名, 行们] of Object.entries(选项.初始 || {})) {
    const t = 造内存表(名, 记录);
    if (行们 && 行们.length) {
      t.Range("A1:" + String.fromCharCode(64 + 行们[0].length) + 行们.length).Value2 = 行们;
    }
    表们.push(t);
  }
  return { app, 表们, 记录 };
}

// AirScript 正文当 Node 函数加载（末尾 return main() 换成导出内部函数）
function 实例化(宿主 = {}) {
  let 源码 = fs.readFileSync(脚本路径, "utf8");
  const 尾 = 源码.lastIndexOf("return main()");
  if (尾 < 0) throw new Error("脚本末尾没有 return main()，加载失败");
  源码 = 源码.slice(0, 尾);
  const 工厂 = new Function(
    "Context", "Application",
    源码 + "\nreturn { scriptVersion, 对照表名, 表头, 是数组, 转净数组, 建对照表, 执行探针, 执行读对照, 执行刷对照, 解析参数, 主函数: main };"
  );
  return 工厂(宿主.Context, 宿主.Application);
}

function 宿主数组(字面量) { return vm.runInNewContext(`(${字面量})`); }

const 表头 = ["源表店铺名", "目标表店铺名", "主体", "是否进主体子表", "备注"];
const 样例行 = [
  ["京东1店", "京东1店", "深圳市德达医疗科技集团有限公司", "是", "明细印证"],
  ["拼多多3店", "拼多多3店", "", "否（无主体）", "待确认：疑旧名"],
  ["德迩杰", "德迩杰", "深圳德迩杰国际发展有限公司", "否（无子表）", ""]
];

async function 该抛错(fn) {
  try { await fn(); return { 抛了: false, 消息: "" }; }
  catch (e) { return { 抛了: true, 消息: String((e && e.message) || e) }; }
}

async function 主() {
  console.log("\n  32号《店铺-主体对照》子表 回归测试\n");

  // ── 1) 脚本版本 + 粘贴安全/单一工作表名 反向断言 ────────────────────────────
  {
    const s = 实例化({ Application: 造应用().app });
    断言(s.scriptVersion === "2026-10-08.1", "脚本版本 2026-10-08.1", s.scriptVersion);
    const 源码 = fs.readFileSync(脚本路径, "utf8");
    const 代码 = 源码.split(/\r?\n/).map((行) => 行.replace(/\/\/.*$/, "")).join("\n");
    断言(源码.indexOf("==") < 0, "源码里没有连续两个等号（粘贴安全）");
    断言(源码.indexOf("===") < 0 && 源码.indexOf("!==") < 0, "源码里也没有 === / !==（含子串 == 也不行）");
    断言(源码.trimEnd().endsWith("return main()"), "末行是顶层 return main()");
    断言(代码.indexOf("汇总") < 0 && 代码.indexOf("深圳市德达医疗科技集团有限公司") < 0 && 代码.indexOf("深圳市德达医疗器械有限公司") < 0,
      "脚本代码不出现别的工作表/主体名（只认『店铺-主体对照』）");
    断言((源码.match(/店铺-主体对照/g) || []).length >= 1 && 源码.indexOf("对照表名 = ") > 0,
      "工作表名只有一个常量 对照表名");
  }

  // ── 2) 探针：没表 → 存在 false 且不建表；有表 → 行数/表头 ────────────────────
  {
    const { app, 记录 } = 造应用();
    const s = 实例化({ Application: app });
    const 报 = s.执行探针();
    断言(报.对照表 && 报.对照表.存在 === false, "探针：没表 → 存在 false", JSON.stringify(报.对照表));
    断言(记录.Add调用.length === 0, "探针：不新建工作表（只读）");
    断言(Array.isArray(报.工作表) && 报.工作表.length === 0, "探针：返回工作表清单（空册）");
  }
  {
    const { app } = 造应用({ 初始: { "店铺-主体对照": [表头].concat(样例行) } });
    const s = 实例化({ Application: app });
    const 报 = s.执行探针();
    断言(报.对照表.存在 && 报.对照表.数据行数 === 3, "探针：已有表 → 数据行数 3", JSON.stringify(报.对照表));
    断言(报.对照表.表头差异.length === 0, "探针：表头一致");
    const 覆盖 = 实例化({ Application: 造应用({ 初始: { "店铺-主体对照": [["店铺", "主体", "", "", ""]] } }).app }).执行探针();
    断言(覆盖.对照表.表头差异.length > 0, "探针：表头不一致 → 报差异", JSON.stringify(覆盖.对照表.表头差异).slice(0, 160));
  }

  // ── 3) 刷对照：无 allowWrite 零写入 ─────────────────────────────────────────
  {
    const { app, 记录 } = 造应用();
    const s = 实例化({ Application: app });
    const 报 = s.执行刷对照({ 行列表: JSON.stringify(样例行) });
    断言(报.written === false && String(报.message).includes("allowWrite"), "刷对照：没有 allowWrite → 拒绝", JSON.stringify(报).slice(0, 160));
    断言(记录.Add调用.length === 0 && 记录.清空.length === 0, "刷对照：拒绝时零写入/零建表");
    const 报2 = 实例化({ Context: { argv: { action: "刷对照", 行列表: JSON.stringify(样例行) } }, Application: app }).主函数();
    断言(报2.written === false && String(报2.message).includes("allowWrite"), "刷对照（主函数）：没有 allowWrite → 拒绝");
  }

  // ── 4) 刷对照：空行列表 / 超上限 → 拒绝 ─────────────────────────────────────
  {
    const s = 实例化({ Application: 造应用().app });
    断言(s.执行刷对照({ 行列表: [], allowWrite: true }).written === false, "刷对照：空行列表 → 拒绝");
    断言(String(s.执行刷对照({ 行列表: [], allowWrite: true }).message).includes("没有行列表"), "刷对照：空行列表报「没有行列表」");
    const 太多 = Array.from({ length: 801 }, () => ["店", "店", "", "否（无主体）", ""]);
    断言(s.执行刷对照({ 行列表: JSON.stringify(太多), allowWrite: true }).written === false, "刷对照：801 行超上限 → 拒绝");
  }

  // ── 5) 刷对照 happy：没表 → Sheets.Add 建表、写表头+数据、回读 0 差异 ────────
  {
    const { app, 表们, 记录 } = 造应用();
    const s = 实例化({ Application: app });
    const 报 = s.执行刷对照({ 行列表: JSON.stringify(样例行), allowWrite: true });
    断言(报.written === true && 报.新建 === true, "刷对照：建表并写入", JSON.stringify(报).slice(0, 200));
    断言(报.写入行数 === 3 && 报.数据末行 === 4, "刷对照：写入 3 行、数据末行 4", JSON.stringify({ 写: 报.写入行数, 末: 报.数据末行 }));
    断言(报.回读差异数 === 0 && 报.差异样例.length === 0, "刷对照：回读 0 差异");
    断言(记录.Add调用.length === 1 && 记录.Add调用[0].via === "Sheets" && 记录.Add调用[0].参数[4] === "店铺-主体对照",
      "刷对照：走 Sheets.Add 且名称=店铺-主体对照", JSON.stringify(记录.Add调用));
    断言(表们.length === 1 && 表们[0].Name === "店铺-主体对照", "刷对照：新表名正确");
    断言(深等于(表们[0].Range("A1:E4").Value2, [表头].concat(样例行)), "刷对照：表头+3 行内容逐格正确", JSON.stringify(表们[0].Range("A1:E4").Value2).slice(0, 160));
    // 主函数路径也走通
    const { app: app2 } = 造应用();
    const 报2 = 实例化({ Context: { argv: { action: "刷对照", 行列表: JSON.stringify(样例行), allowWrite: true } }, Application: app2 }).主函数();
    断言(报2.written === true && 报2.回读差异数 === 0, "刷对照（主函数）：写入成功");
  }

  // ── 6) 刷对照：覆盖旧数据 + 清掉多余行（只清 A~E，不动 F 列）────────────────
  {
    const 旧 = [表头,
      ["旧1", "旧1", "深圳市德达医疗科技集团有限公司", "是", ""],
      ["旧2", "旧2", "深圳市德达医疗科技集团有限公司", "是", ""],
      ["旧3", "旧3", "深圳市德达医疗科技集团有限公司", "是", ""],
      ["旧4", "旧4", "深圳市德达医疗科技集团有限公司", "是", ""],
      ["旧5", "旧5", "深圳市德达医疗科技集团有限公司", "是", ""]];
    const { app, 表们, 记录 } = 造应用({ 初始: { "店铺-主体对照": 旧 } });
    表们[0].Range("F1").Value2 = [["不动"]];
    const s = 实例化({ Application: app });
    const 报 = s.执行刷对照({ 行列表: JSON.stringify(样例行.slice(0, 2)), allowWrite: true });
    断言(报.written === true && 报.写前末行 === 6, "刷对照：旧末行 6 → 覆盖写入", JSON.stringify({ 写前: 报.写前末行, 写: 报.写入行数 }));
    断言(String(报.清理).includes("A4:E6") && String(报.清理).includes("3 行"), "刷对照：清理范围 A4:E6（3 行）报出来", String(报.清理));
    断言(深等于(表们[0].Range("A1:E3").Value2, [表头].concat(样例行.slice(0, 2))), "刷对照：覆盖后 A1:E3 正确");
    断言(表们[0].Range("A4:E6").Value2.every((r) => r.every((v) => v === "")), "刷对照：多余旧行已清空");
    断言(深等于(表们[0].Range("F1:F1").Value2, [["不动"]]), "刷对照：不碰 F 列（只动 A~E）");
    断言(记录.清空.length === 1 && 记录.清空[0].地址 === "A4:E6", "刷对照：ClearContents 只落在 A4:E6", JSON.stringify(记录.清空));
  }

  // ── 7) 刷对照：表头不对 → 停手（一个字节不写）──────────────────────────────
  {
    const { app, 表们, 记录 } = 造应用({ 初始: { "店铺-主体对照": [["店铺", "主体", "", "", ""], ["旧", "x", "", "", ""]] } });
    const s = 实例化({ Application: app });
    const 报 = s.执行刷对照({ 行列表: JSON.stringify(样例行), allowWrite: true });
    断言(报.written === false && String(报.message).includes("表头"), "刷对照：表头不对 → 拒绝", JSON.stringify(报).slice(0, 200));
    断言(记录.清空.length === 0, "刷对照：表头不对 → 不清理");
    断言(深等于(表们[0].Range("A1:E2").Value2, [["店铺", "主体", "", "", ""], ["旧", "x", "", "", ""]]), "刷对照：表头不对 → 内容原样未动");
  }

  // ── 8) 刷对照：宿主数组（vm 跨 realm）与 列数修正 ───────────────────────────
  {
    const { app, 表们 } = 造应用();
    const s = 实例化({ Application: app });
    const 宿主 = 宿主数组('[["甲店","甲店","深圳市德达医疗器械有限公司","是","注"],["乙店","乙店","","否（无主体）",""]]');
    断言(!(宿主 instanceof Array), "（前提）vm 宿主数组 instanceof Array 为 false");
    const 报 = s.执行刷对照({ 行列表: 宿主, allowWrite: true });
    断言(报.written === true && 报.回读差异数 === 0, "刷对照：宿主数组也能写入", JSON.stringify(报).slice(0, 160));
    断言(深等于(表们[0].Range("A2:E3").Value2, [["甲店", "甲店", "深圳市德达医疗器械有限公司", "是", "注"], ["乙店", "乙店", "", "否（无主体）", ""]]),
      "刷对照：宿主数组内容正确");
  }
  {
    const { app, 表们 } = 造应用();
    const s = 实例化({ Application: app });
    const 报 = s.执行刷对照({ 行列表: JSON.stringify([["甲店", "甲店", "深圳市德达医疗科技集团有限公司", "是", "注", "多一列"], ["乙店", "乙店"]]), allowWrite: true });
    断言(报.written === true && 报.列数修正 === 2, "刷对照：列数修正计数 = 2", String(报.列数修正));
    断言(深等于(表们[0].Range("A2:E3").Value2, [["甲店", "甲店", "深圳市德达医疗科技集团有限公司", "是", "注"], ["乙店", "乙店", "", "", ""]]),
      "刷对照：多列截断、缺列补空（只写 5 列）");
  }

  // ── 9) 读对照：全表 5 列；没表 → 存在 false ──────────────────────────────────
  {
    const { app } = 造应用({ 初始: { "店铺-主体对照": [表头].concat(样例行) } });
    const s = 实例化({ Application: app });
    const 报 = s.执行读对照();
    断言(报.存在 && 报.数据行数 === 3 && 深等于(报.表头, 表头), "读对照：表头+3 行", JSON.stringify(报).slice(0, 200));
    断言(深等于(报.行列表, 样例行), "读对照：5 列内容正确", JSON.stringify(报.行列表).slice(0, 160));
    const 空 = 实例化({ Application: 造应用().app }).执行读对照();
    断言(空.存在 === false, "读对照：没表 → 存在 false");
  }

  // ── 10) 建表兜底：Sheets 不可用时走 Worksheets.Add 再改名 ────────────────────
  {
    const { app, 表们, 记录 } = 造应用({ 没有Sheets: true });
    const s = 实例化({ Application: app });
    const 报 = s.执行刷对照({ 行列表: JSON.stringify(样例行.slice(0, 1)), allowWrite: true });
    断言(报.written === true && 记录.Add调用[0].via === "Worksheets" && 表们[0].Name === "店铺-主体对照",
      "刷对照：Sheets 不可用 → Worksheets.Add 兜底并改名", JSON.stringify({ via: 记录.Add调用[0].via, 名: 表们[0].Name }));
  }

  // ── 11) 本地客户端：真实源文件 → 62 行（42 对照 + 20 历史）──────────────────
  const 源文件 = path.join(项目根, "runtime", "对照", "店铺-主体-全量.json");
  if (fs.existsSync(源文件)) {
    const 源数据 = JSON.parse(fs.readFileSync(源文件, "utf8"));
    const 行列表 = 客户端.校验行列表(客户端.构建行列表(源数据));
    断言(行列表.length === 62, "客户端：42 条对照 + 20 历史 = 62 行", String(行列表.length));
    断言(行列表.every((r) => Array.isArray(r) && r.length === 5), "客户端：每行 5 列");
    断言(行列表.every((r) => r[2] === "" || 客户端.主体白名单.includes(r[2])), "客户端：所有主体都在白名单（或空）");
    断言(行列表.every((r) => r[3] === "是" || r[3].startsWith("否")), "客户端：是否进主体子表 只能是/否");
    断言(行列表.filter((r) => r[3] === "是").length === 31, "客户端：进子表 31 行（抖音02店已改归德迩杰/无子表）", String(行列表.filter((r) => r[3] === "是").length));
    断言(行列表.filter((r) => r[3] === "否（无子表）").length === 8, "客户端：否（无子表）8 行（含抖音02店）");
    断言(行列表.filter((r) => r[3] === "否（无主体）").length === 23, "客户端：否（无主体）23 行（含 20 个历史店铺）");
    const 抖音 = 行列表.find((r) => r[0] === "抖音02店");
    断言(抖音 && 抖音[1] === "抖音02店" && 抖音[2] === "深圳德迩杰国际发展有限公司" && 抖音[3] === "否（无子表）",
      "客户端：抖音02店 按黎路遥拍板（德迩杰/无子表）", JSON.stringify(抖音));
    断言(抖音 && 抖音[4].includes("德迩杰") && 抖音[4].includes("不看历史"), "客户端：抖音02店 备注写明口径来源", 抖音 && 抖音[4]);
    断言(行列表.find((r) => r[0] === "拼多多3店")[4].startsWith("待确认"), "客户端：拼多多3店 备注「待确认」");
    断言(行列表.find((r) => r[0] === "拼多多6店")[4].startsWith("待确认"), "客户端：拼多多6店 备注「待确认」");
    断言(行列表.find((r) => r[0] === "抖音01店")[4].startsWith("待确认"), "客户端：抖音01店 备注「待确认」");
    断言(行列表.slice(-20).every((r) => r[3] === "否（无主体）" && r[2] === ""), "客户端：末尾 20 个历史店铺都是否（无主体）");
  } else {
    console.log("  ⏭ 跳过真实源文件断言（runtime/对照/店铺-主体-全量.json 不在）");
  }

  // ── 12) 客户端：构建 + 守卫（fixture 不依赖 runtime）────────────────────────
  {
    const 最小 = {
      对照: [{ 源表店铺名: "甲店", "目标表店铺名(规范化后)": "甲店", 主体: "深圳市德达医疗器械有限公司", 是否进主体子表: true, 备注: "" }],
      历史无主体店铺: [{ 店铺: "老店", 行数: 3, 行号: "10~20", 最近出现: 20 }]
    };
    const 行 = 客户端.构建行列表(最小);
    断言(深等于(行, [["甲店", "甲店", "深圳市德达医疗器械有限公司", "是", ""], ["老店", "老店", "", "否（无主体）", "历史店铺：无主体记录（3 行，10~20）；后续再出现需人工确认"]]),
      "客户端：小明细 fixture 构建正确", JSON.stringify(行));
    断言(客户端.校验行列表(行).length === 2, "客户端：fixture 过守卫");
    const 坏主体 = { 对照: [{ 源表店铺名: "甲店", 目标表店铺名: "甲店", 主体: "某新公司", 是否进主体子表: true }], 历史无主体店铺: [] };
    断言((await 该抛错(() => 客户端.构建行列表(坏主体))).抛了, "客户端：出现白名单外新主体 → 构建就抛错");
    断言((await 该抛错(() => 客户端.构建行列表({ 对照: [], 历史无主体店铺: [] }))).抛了, "客户端：没有对照数组 → 抛错");

    const 守卫种 = [
      ["列数不对", [["店", "店", "", "否", "", "多"]], "5 列"],
      ["是但主体不是两子表", [["店", "店", "深圳德达康健科技有限公司", "是", ""]], "不是两个子表主体"],
      ["否但主体是两子表之一", [["店", "店", "深圳市德达医疗器械有限公司", "否（无子表）", ""]], "却填了"],
      ["是否值不合法", [["店", "店", "", "随便", ""]], "只能 是/否"],
      ["主体不在白名单", [["店", "店", "外星公司", "否（无主体）", ""]], "不在白名单"],
      ["店铺重复", [["店", "店", "", "否（无主体）", ""], ["店", "店", "", "否（无主体）", ""]], "重复"],
      ["源表店铺名为空", [["", "店", "", "否（无主体）", ""]], "源表店铺名为空"]
    ];
    for (const [名, 坏行, 关键词] of 守卫种) {
      const r = await 该抛错(() => 客户端.校验行列表(坏行));
      断言(r.抛了 && r.消息.includes(关键词), `客户端守卫：${名} → 拒绝（${关键词}）`, r.消息);
    }
  }

  // ── 13) 客户端：payload 形状 + 取Webhook 三种键位 ───────────────────────────
  {
    const 载荷 = 客户端.造载荷(样例行);
    断言(载荷.action === "刷对照" && 载荷.allowWrite === true, "客户端：payload action=刷对照 / allowWrite=true");
    断言(typeof 载荷.行列表 === "string" && 深等于(JSON.parse(载荷.行列表), 样例行), "客户端：行列表 是 JSON 字符串（宿主数组坑）");
    断言(客户端.取Webhook({ scripts: { 店铺主体对照: { webhookUrl: "https://a" } } }) === "https://a", "客户端：webhook 读 scripts.店铺主体对照.webhookUrl");
    断言(客户端.取Webhook({ 店铺主体对照: { webhookUrl: "https://b" } }) === "https://b", "客户端：webhook 读顶层对象 店铺主体对照.webhookUrl");
    断言(客户端.取Webhook({ "店铺主体对照.webhookUrl": "https://c" }) === "https://c", "客户端：webhook 读字面键 店铺主体对照.webhookUrl");
    断言(客户端.取Webhook({}) === "", "客户端：没有配置 → 空");
  }

  // ── 14) 客户端：反向断言——只回 status:'已写入' 没有 written:true 必判失败 ────
  {
    const 坏1 = await 该抛错(() => 客户端.校验结果({ status: "已写入" }));
    断言(坏1.抛了 && 坏1.消息.includes("written:true"), "反向断言：{status:'已写入'} → 判失败", 坏1.消息);
    const 坏2 = await 该抛错(() => 客户端.校验结果({ written: false, message: "没有 allowWrite" }));
    断言(坏2.抛了, "反向断言：{written:false} → 判失败");
    const 坏3 = await 该抛错(() => 客户端.校验结果({ written: true, 回读差异数: 1, 差异样例: [{ 行: 2, 列: 1 }] }));
    断言(坏3.抛了 && 坏3.消息.includes("回读"), "反向断言：回读差异 1 → 判失败", 坏3.消息);
    const 好 = 客户端.校验结果({ written: true, 回读差异数: 0, 写入行数: 62, 新建: false, 清理: "" });
    断言(好.写入行数 === 62, "正例：written:true + 回读 0 → 通过");
  }

  // ── 15) 客户端：跑()（注入假调脚本；--预演 不调 webhook）─────────────────────
  {
    const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), "32-duizhao-"));
    const 临时源 = path.join(临时, "源.json");
    fs.writeFileSync(临时源, JSON.stringify({
      对照: [{ 源表店铺名: "甲店", "目标表店铺名(规范化后)": "甲店", 主体: "深圳市德达医疗器械有限公司", 是否进主体子表: true, 备注: "" }],
      历史无主体店铺: []
    }), "utf8");
    const 调用 = [];
    const 假调 = async (argv) => {
      调用.push(argv);
      if (argv.action === "探针") return { 对照表: { 存在: true } };
      if (argv.action === "读对照") return { 存在: true, 数据行数: 1, 表头, 行列表: [["甲店", "甲店", "深圳市德达医疗器械有限公司", "是", ""]] };
      return { written: true, 回读差异数: 0, 写入行数: 1, 数据末行: 2, 新建: false, 清理: "" };
    };
    const 探 = await 客户端.跑({ 模式: "探针" }, { 调脚本: 假调, 证据目录: path.join(临时, "证据") });
    断言(调用[0].action === "探针" && 探.结果.对照表.存在, "跑(探针)：调 action=探针");
    const 读 = await 客户端.跑({ 模式: "读对照" }, { 调脚本: 假调, 证据目录: path.join(临时, "证据") });
    断言(读.结果.行列表.length === 1, "跑(读对照)：返回行列表");
    const 预 = await 客户端.跑({ 模式: "刷对照", 预演: true, 源: 临时源 }, {
      调脚本: async () => { throw new Error("预演不该调 webhook"); },
      证据目录: path.join(临时, "证据")
    });
    断言(预.预演 === true && 预.行列表.length === 1, "跑(刷对照 --预演)：零请求、行列表已构建");
    const 刷 = await 客户端.跑({ 模式: "刷对照", 源: 临时源 }, { 调脚本: 假调, 证据目录: path.join(临时, "证据") });
    断言(刷.审.写入行数 === 1 && 调用[调用.length - 1].action === "刷对照" && 调用[调用.length - 1].allowWrite === true,
      "跑(刷对照)：载荷 action/allowWrite 正确，成功判定通过", JSON.stringify(调用[调用.length - 1]).slice(0, 160));
    const 坏 = await 该抛错(() => 客户端.跑({ 模式: "刷对照", 源: 临时源 }, {
      调脚本: async () => ({ status: "已写入" }),
      证据目录: path.join(临时, "证据")
    }));
    断言(坏.抛了, "跑(刷对照)：服务端只回 status → 跑() 抛错（退出码 1 路径）", 坏.消息);
  }

  console.log(`\n  结果：通过 ${通过} / 失败 ${失败}\n`);
  if (失败) process.exitCode = 1;
}

主().catch((错误) => {
  console.error(`\n  测试自己炸了：${错误 && 错误.stack ? 错误.stack : 错误}\n`);
  process.exitCode = 1;
});
