#!/usr/bin/env node
// 32号《补差-刷新与税金》回归测试（2026-10-08 拆分 v6 后新脚本 ②）：
//   ① AirScript 正文按 Node 函数加载，用内存假表+假透视验证：探针只读、无 allowWrite 零写入；
//      刷新与税金 happy：RefreshTable → 读布局 → 只写 F/G（税金=ROUND(总计/1.13*0.13,2)、收入=总计-税金）
//      → F:G 设 '0.00_ ' → 清下面多余行 → 回读；**除 F/G 与本表透视外不碰任何格**；
//   ② 守卫：找不到透视锚点 / 只有锚点没有 PivotTable 对象 → 本表跳过并回报问题，零写入；
//      RefreshTable 抛错走 Refresh 兜底；两个都抛错 → 刷新方式 = '失败：…'（不重试）；
//   ③ 本地客户端：载荷形状（action=刷新与税金 + allowWrite:true）、反向断言
//      （只回 status:'已写入' 没有两组结果必判失败；有「问题」/刷新失败必判失败）。
// 跑：node tests/补差-刷新与税金.test.cjs
const fs = require("node:fs");
const path = require("node:path");

const 项目根 = path.resolve(__dirname, "..");
const 脚本路径 = path.join(项目根, "kdocs-scripts", "AirScript-补差-刷新与税金.md");
const 客户端 = require(path.join(项目根, "scripts", "补差-刷新与税金.cjs"));

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
function 列名(n) { return String.fromCharCode(64 + n); }

// 内存假表：Value2/Formula/NumberFormat/ClearContents + 可选假透视（锚点行）。
function 造假表(名, 选项 = {}) {
  const 值 = new Map();
  const 公式 = new Map();
  const 格式 = new Map();
  const 记录 = { 公式写入: [], 格式写入: [], 清空: [], 刷新: 0 };
  const 键 = (r, c) => r + "," + c;
  for (const [地址, v] of Object.entries(选项.初始 || {})) {
    const m = /^([A-Z]+)(\d+)$/.exec(地址);
    if (m) 值.set(键(Number(m[2]), 列号(m[1])), v);
  }
  const 透视 = 选项.透视 || null;
  const 假透视 = 透视 ? {
    get Name() { return 透视.名 || ""; },
    get SourceData() { return 透视.源 || ""; },
    get Location() { return 透视.位置 || ""; },
    RefreshTable() {
      if (透视.刷新抛错) throw new Error("RefreshTable 不可用");
      记录.刷新 += 1;
    },
    Refresh() {
      if (透视.刷新也抛错) throw new Error("Refresh 也不可用");
      记录.刷新 += 1;
    }
  } : null;
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
      set NumberFormat(f) { 格式.set(键(r, c), String(f)); 记录.格式写入.push({ 地址: 列名(c) + r, 格式: String(f) }); },
      get PivotTable() { return 透视 && r === 透视.锚行 && c === 1 ? 假透视 : null; }
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
          for (let r = a.r1; r <= a.r2; r += 1) {
            const 源行 = v[r - a.r1];
            for (let c = a.c1; c <= a.c2; c += 1) 值.set(键(r, c), Array.isArray(源行) ? 源行[c - a.c1] : "");
          }
        },
        get Formula() { return 建单格(a.r1, a.c1).Formula; },
        set Formula(f) { 建单格(a.r1, a.c1).Formula = f; },
        get NumberFormat() { return 建单格(a.r1, a.c1).NumberFormat; },
        set NumberFormat(f) {
          for (let r = a.r1; r <= a.r2; r += 1) for (let c = a.c1; c <= a.c2; c += 1) {
            格式.set(键(r, c), String(f));
            记录.格式写入.push({ 地址: 列名(c) + r, 格式: String(f) });
          }
        },
        ClearContents() {
          记录.清空.push(地址);
          for (let r = a.r1; r <= a.r2; r += 1) for (let c = a.c1; c <= a.c2; c += 1) { 值.delete(键(r, c)); 公式.delete(键(r, c)); }
        },
        get PivotTable() { return 透视 && 地址 === "A" + 透视.锚行 ? 假透视 : null; }
      };
    }
  };
  return { 表, 记录, 值, 公式, 格式 };
}

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

const 集团名 = "深圳市德达医疗科技集团有限公司";
const 器械名 = "深圳市德达医疗器械有限公司";

// 一个带透视的主体表初始数据（锚点 20，头行 22，数据 23~25，总计行 25）
function 主体初始() {
  return {
    初始: {
      A20: "求和项:金额",
      A21: "类型",
      A22: "店铺", C22: "总计",
      A23: "京东6店", C23: 438,
      A24: "京东3店", C24: 56.75,
      A25: "总计", C25: 494.75
    }
  };
}
function 造两表(选项 = {}) {
  const 集团 = 造假表(集团名, { ...主体初始(), 透视: { 锚行: 20, 名: "透视表1", 源: "A4:K19", 位置: "A20", ...(选项.集团透视 || {}) } });
  const 器械 = 造假表(器械名, { ...主体初始(), 透视: { 锚行: 20, 名: "透视表2", 源: "A4:K12", 位置: "A20", ...(选项.器械透视 || {}) } });
  return { 集团, 器械, app: 造应用([集团.表, 器械.表]) };
}

function 实例化(宿主 = {}) {
  let 源码 = fs.readFileSync(脚本路径, "utf8");
  const 尾 = 源码.lastIndexOf("return main()");
  if (尾 < 0) throw new Error("脚本末尾没有 return main()，加载失败");
  源码 = 源码.slice(0, 尾);
  const 工厂 = new Function(
    "Context", "Application",
    源码 + "\nreturn { scriptVersion, 执行探针, 执行刷新与税金, 解析参数, 主函数: main };"
  );
  return 工厂(宿主.Context, 宿主.Application);
}

async function 该抛错(fn) {
  try { await fn(); return { 抛了: false, 消息: "" }; }
  catch (e) { return { 抛了: true, 消息: String((e && e.message) || e) }; }
}

async function 主() {
  console.log("\n  32号《补差-刷新与税金》回归测试（拆分 v6 后新脚本 ②）\n");

  // ── 1) 脚本版本 + 粘贴安全 + 只认两个主体表 ────────────────────────────────
  {
    const s = 实例化({ Application: 造应用([]) });
    断言(s.scriptVersion === "2026-10-08.1", "脚本版本 2026-10-08.1", s.scriptVersion);
    const 源码 = fs.readFileSync(脚本路径, "utf8");
    断言(!源码.includes("==") && !源码.includes("!==") && !源码.includes("==="), "源码里没有连续两个等号（粘贴安全）");
    断言(源码.trimEnd().endsWith("return main()"), "末行是顶层 return main()");
    断言(!源码.includes("'汇总'") && !源码.includes("汇总表名"), "脚本不认汇总表（只动两个主体子表）");
  }

  // ── 2) 无 allowWrite：零写入（不刷新、不写公式、不清空）──────────────────────
  {
    const 表组 = 造两表();
    const s = 实例化({ Context: { argv: { action: "刷新与税金" } }, Application: 表组.app });
    const 报 = s.主函数();
    断言(报.written === false && String(报.message).includes("allowWrite"), "main(无 allowWrite) → 拒绝", JSON.stringify(报).slice(0, 160));
    断言(表组.集团.记录.刷新 === 0 && 表组.集团.记录.公式写入.length === 0 && 表组.集团.记录.清空.length === 0, "无 allowWrite：集团零刷新/零写入");
    断言(表组.器械.记录.刷新 === 0 && 表组.器械.记录.格式写入.length === 0, "无 allowWrite：器械零刷新/零格式改动");
  }

  // ── 3) 刷新与税金 happy：只刷新本表透视 + 只写 F/G + 清多余 + 回读 ──────────
  {
    const 表组 = 造两表();
    const s = 实例化({ Application: 表组.app });
    const 报 = s.执行刷新与税金();
    断言(报.集团.刷新方式 === "RefreshTable" && 表组.集团.记录.刷新 === 1, "集团：RefreshTable 调用一次", JSON.stringify({ 方式: 报.集团.刷新方式, 刷新: 表组.集团.记录.刷新 }));
    断言(报.器械.刷新方式 === "RefreshTable" && 表组.器械.记录.刷新 === 1, "器械：RefreshTable 调用一次");
    断言(报.集团.数据起 === 23 && 报.集团.数据止 === 25 && 报.集团.总计列 === 3 && 报.集团.写公式行数 === 3, "集团：布局读出 23~25 / 总计列 C / 写 3 行", JSON.stringify({ 起: 报.集团.数据起, 止: 报.集团.数据止, 总: 报.集团.总计列 }));
    const F = 表组.集团.记录.公式写入;
    断言(F.length === 6, "集团：F/G 各写 3 行 = 6 次公式写入", String(F.length));
    断言(深等于(F.map((x) => x.公式), [
      "=ROUND(C23/1.13*0.13,2)", "=C23-F23",
      "=ROUND(C24/1.13*0.13,2)", "=C24-F24",
      "=ROUND(C25/1.13*0.13,2)", "=C25-F25"
    ]), "集团：税金 = ROUND(总计/1.13*0.13,2)、收入 = 总计-税金（口径原样搬 v6）", JSON.stringify(F.map((x) => x.公式)));
    断言(F.every((x) => /^[FG]\d+$/.test(x.地址)), "集团：公式只写 F/G 列（其它列一个字节不碰）", JSON.stringify(F.map((x) => x.地址)));
    断言(表组.集团.记录.格式写入.length === 6 && 表组.集团.记录.格式写入.every((x) => /^[FG]\d+$/.test(x.地址) && x.格式 === "0.00_ "), "集团：F23:G25 设 '0.00_ '（只在 F/G 列）");
    断言(深等于(表组.集团.记录.清空, ["F26:G100"]), "集团：清掉 F26:G100（上次行数更多的旧税金/收入）", JSON.stringify(表组.集团.记录.清空));
    断言(Array.isArray(报.集团.回读) && 报.集团.回读.length === 4 && 报.集团.回读[0][0] === "店铺", "集团：回读总览（头行 22~25）", JSON.stringify(报.集团.回读).slice(0, 160));
    断言(表组.集团.记录.公式写入.filter((x) => x.地址 === "F23")[0].公式 === "=ROUND(C23/1.13*0.13,2)", "集团：F23 公式落对行（不是别的行）");
  }

  // ── 4) 兜底与失败：RefreshTable 抛错走 Refresh；两个都抛错 → 失败不重试 ──────
  {
    const 表组 = 造两表({ 集团透视: { 刷新抛错: true }, 器械透视: { 刷新抛错: true, 刷新也抛错: true } });
    const s = 实例化({ Application: 表组.app });
    const 报 = s.执行刷新与税金();
    断言(报.集团.刷新方式 === "Refresh" && 表组.集团.记录.刷新 === 1, "集团：RefreshTable 抛错 → Refresh 兜底一次", String(报.集团.刷新方式));
    断言(String(报.器械.刷新方式).startsWith("失败") && 表组.器械.记录.刷新 === 0, "器械：两种刷新都抛错 → 刷新方式=失败、不重试", JSON.stringify(报.器械.刷新方式));
    断言(表组.器械.记录.公式写入.length === 6, "器械：刷新失败仍按 v6 原逻辑写 F/G（客户端拿到「失败」会判失败停手；不顺手改 v6 行为）", String(表组.器械.记录.公式写入.length));
  }

  // ── 5) 守卫：没有透视锚点 / 只有锚点没有透视对象 → 本表跳过零写入 ────────────
  {
    const 集团 = 造假表(集团名, { 初始: { A4: "甲", A5: "乙" } });
    const 器械 = 造假表(器械名, { 初始: { A20: "求和项:金额" } }); // 只有锚点，Cells().PivotTable 为 null
    const s = 实例化({ Application: 造应用([集团.表, 器械.表]) });
    const 报 = s.执行刷新与税金();
    断言(String(报.集团.问题).includes("没找到"), "集团：A 列表无「求和项」→ 问题回报", JSON.stringify(报.集团).slice(0, 160));
    断言(String(报.器械.问题).includes("PivotTable"), "器械：只有锚点没透视对象 → 问题回报", JSON.stringify(报.器械).slice(0, 160));
    断言(集团.记录.公式写入.length === 0 && 集团.记录.清空.length === 0 && 集团.记录.刷新 === 0, "守卫不过：集团零写入");
  }

  // ── 6) 探针：只读回报锚点/布局/税金现状 ────────────────────────────────────
  {
    const 表组 = 造两表();
    表组.集团.值.set("23,6", 50.36);
    表组.集团.值.set("23,7", 387.64);
    const s = 实例化({ Application: 表组.app });
    const 报 = s.执行探针();
    断言(报.模式 === "探针" && 报.集团.透视 && 报.集团.透视.锚行 === 20 && 报.集团.布局.数据起 === 23, "探针：集团锚点/布局回报", JSON.stringify(报.集团).slice(0, 200));
    断言(报.集团.财务格[0].税金.值 === "50.36" && 报.集团.财务格[0].收入.值 === "387.64", "探针：F/G 现值回报");
    断言(表组.集团.记录.公式写入.length === 0 && 表组.集团.记录.刷新 === 0 && 表组.器械.记录.清空.length === 0, "探针：零写入/零刷新（只读）");
  }

  // ── 7) 客户端：载荷形状 + 反向断言 ──────────────────────────────────────────
  {
    const 调用 = [];
    const 跑 = await 客户端.跑({ 模式: "刷新与税金" }, {
      调脚本: async (argv) => { 调用.push(argv); return { 集团: { 刷新方式: "RefreshTable", 数据起: 23, 数据止: 25, 写公式行数: 3 }, 器械: { 刷新方式: "RefreshTable", 数据起: 23, 数据止: 25, 写公式行数: 3 } }; },
      证据目录: path.join(require("node:os").tmpdir(), "32-shuaxin-" + Date.now())
    });
    断言(调用.length === 1 && 调用[0].action === "刷新与税金" && 调用[0].allowWrite === true, "跑(刷新与税金)：载荷 action=刷新与税金 + allowWrite:true", JSON.stringify(调用[0]));
    断言(跑.结果.集团.写公式行数 === 3, "跑(刷新与税金)：happy 通过");

    const 坏1 = await 该抛错(() => 客户端.校验刷新结果({ status: "已写入" }));
    断言(坏1.抛了 && 坏1.消息.includes("集团/器械"), "反向断言：只回 status:'已写入' → 必判失败", 坏1.消息);
    const 坏2 = await 该抛错(() => 客户端.校验刷新结果({ 集团: { 问题: "没有透视" }, 器械: { 刷新方式: "RefreshTable" } }));
    断言(坏2.抛了 && 坏2.消息.includes("问题"), "反向断言：某表有「问题」→ 判失败", 坏2.消息);
    const 坏3 = await 该抛错(() => 客户端.校验刷新结果({ 集团: { 刷新方式: "失败：RefreshTable 不可用" }, 器械: { 刷新方式: "RefreshTable" } }));
    断言(坏3.抛了 && 坏3.消息.includes("刷新方式"), "反向断言：刷新方式=失败 → 判失败", 坏3.消息);
    const 好 = 客户端.校验刷新结果({ 集团: { 刷新方式: "RefreshTable" }, 器械: { 刷新方式: "Refresh" } });
    断言(好.集团.刷新方式 === "RefreshTable", "正例：两组都成功 → 通过");

    const 探 = await 客户端.跑({ 模式: "探针" }, { 调脚本: async (argv) => ({ action: argv.action }), 证据目录: path.join(require("node:os").tmpdir(), "32-shuaxin-tan-" + Date.now()) });
    断言(探.结果.action === "探针", "跑(探针)：调 action=探针");
  }

  console.log(`\n  结果：通过 ${通过} / 失败 ${失败}\n`);
  if (失败) process.exitCode = 1;
}

主().catch((错误) => {
  console.error(`\n  测试自己炸了：${错误 && 错误.stack ? 错误.stack : 错误}\n`);
  process.exitCode = 1;
});
