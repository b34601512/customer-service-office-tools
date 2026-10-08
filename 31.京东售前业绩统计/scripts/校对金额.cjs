#!/usr/bin/env node
// 31号：「校对金额」——涉工资必做的一道校对（黎路遥 2026-10-08 定）。
// 本地「促成订单」导出（按 manifest 汇总，口径与导入一致）⇄ 京东客服管家系统统计（只读），
// 逐客 + 逐店 + 总计对比；差异率 ≥1% 标 ⚠ 并在结尾单列。
//
// 用法：
//   node scripts/校对金额.cjs --年月 2026-09 [--store jd8] [--本地文件 runtime/downloads/2026-09]
//        [--跳过系统] [--系统来源 新页|旧页] [--输出 runtime/校对-2026-09] [--不截图]
//
// 系统来源（默认新页）：
//   · 新页 = xi.jd.com/kf-manage-lite【店铺数据→数据明细】，接口 kf.jd.com/jingmai/T1/queryIndicatorDim
//   · 旧页 = xi.jd.com/customerassistant【客服数据对比→销售绩效对比】，接口 kf.jd.com/waiterContrast/sales/queryList
//
// 安全（不许改坏）：
//   · 平台后台只读：只设查询条件 + 点「查询」+ 读接口 + 截图；绝不点「导出数据/导出Excel」、保存、提交。
//   · 登录失效/滑块 → 停下报人、留证据；不自动重试；单店失败不拖垮其他店（标「未校到」）。
//   · 输出：<输出>/对比-<运行日期>.{md,json}、本地方-按客服汇总.json、系统方/<店>_*.json/.png。

const fs = require("node:fs");
const path = require("node:path");
const { 汇总 } = require("./校对-本地方-按客服汇总.cjs");
const { 全部店铺 } = require("../src/config/stores");
const engine = require("../src/engine/browser");
const { 读映射缓存, 建匹配器 } = require("./导入管家数据.cjs");

const 项目根 = path.resolve(__dirname, "..");
const 新页URL = "https://xi.jd.com/kf-manage-lite/#/DataAnalysis/ReceptionData";
const 旧页URL = "https://xi.jd.com/customerassistant/filterCustomer.html?menu=waiterContrast&content=salesData";
const 睡觉 = (ms) => new Promise((r) => setTimeout(r, ms));

// —————————————— 纯逻辑（可单测） ——————————————

function 解析参数(argv) {
  const 参数 = { 年月: "", store: "", 本地文件: "", 跳过系统: false, 系统来源: "新页", 输出: "", 不截图: false, 帮助: false };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--年月") { 参数.年月 = argv[i + 1] || ""; i += 1; }
    else if (词 === "--store") { 参数.store = argv[i + 1] || ""; i += 1; }
    else if (词 === "--本地文件") { 参数.本地文件 = argv[i + 1] || ""; i += 1; }
    else if (词 === "--系统来源") { 参数.系统来源 = argv[i + 1] || ""; i += 1; }
    else if (词 === "--输出") { 参数.输出 = argv[i + 1] || ""; i += 1; }
    else if (词 === "--跳过系统") 参数.跳过系统 = true;
    else if (词 === "--不截图") 参数.不截图 = true;
    else if (词 === "--help" || 词 === "-h") 参数.帮助 = true;
    else throw new Error(`未知参数：${词}（--help 看用法）`);
  }
  if (!参数.帮助 && !/^\d{4}-\d{2}$/.test(参数.年月)) throw new Error(`缺 --年月，格式 YYYY-MM，如 --年月 2026-09`);
  if (!["新页", "旧页"].includes(参数.系统来源)) throw new Error(`--系统来源 只能是 新页|旧页，收到：${参数.系统来源}`);
  return 参数;
}

function 用法() {
  console.log(`用法：
  node scripts/校对金额.cjs --年月 2026-09 [--store jd8] [--本地文件 runtime/downloads/2026-09]
       [--跳过系统] [--系统来源 新页|旧页] [--输出 runtime/校对-2026-09] [--不截图]
说明：
  · 本地：按 <本地文件>/manifest.json 汇总每店×每客服（行数 + Σ单价×数量；单价直和作参考）。
  · 系统：默认新页（kf-manage-lite 店铺数据→数据明细）；--系统来源 旧页 = 销售绩效对比。
  · 默认 6 店循环；单店失败不拖垮其他店，标「未校到」；登录失效/滑块 → 停下报人、不自动重试。
  · 只读：只设查询条件 + 点「查询」+ 读接口 + 截图；绝不点导出/保存/提交。
  · 差异率 ≥1% 的行标 ⚠ 并在结尾单列；输出 <输出>/对比-<运行日期>.{md,json}。`);
}

// "2026-09" → { start: "2026-09-01", end: "2026-09-30" }
function 解析年月(年月) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(年月 || ""));
  if (!m) throw new Error(`年月格式应为 YYYY-MM：${年月}`);
  const 年 = Number(m[1]); const 月 = Number(m[2]);
  if (月 < 1 || 月 > 12) throw new Error(`年月不合法：${年月}`);
  const 末日 = new Date(年, 月, 0).getDate();
  const 两 = (n) => String(n).padStart(2, "0");
  return { start: `${年}-${两(月)}-01`, end: `${年}-${两(月)}-${两(末日)}` };
}

function 金额(v) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function 到分(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Number(v.toFixed(2)) : 0;
}

// 差异率（%）=（本地-系统）/系统×100；系统为 0 且本地非 0 → null（未定义）
function 算差异率(本地金额, 系统金额) {
  const 本 = 到分(本地金额); const 系 = 到分(系统金额);
  if (系 === 0) return 本 === 0 ? 0 : null;
  return Number((((本 - 系) / 系) * 100).toFixed(3));
}

// 差异率 ≥阈值% 才算超；系统为 0、本地非 0 视为超（无法算率但显然有差）
function 超阈值(本地金额, 系统金额, 阈值 = 1) {
  const 本 = 到分(本地金额); const 系 = 到分(系统金额);
  if (本 === 系) return false;
  if (系 === 0) return 本 !== 0;
  return Math.abs(((本 - 系) / 系) * 100) >= 阈值;
}

// manifest 兼容「年月 / yearMonth」两种写法
function 归一清单(原) {
  return {
    yearMonth: 原.yearMonth || 原.年月 || "",
    files: (原.files || []).map((f) => ({ file: f.file, store: f.store || "", key: f.key || "" }))
  };
}

// 本地汇总：复用「校对-本地方-按客服汇总.cjs」（口径与 导入管家数据.cjs 完全一致）
function 汇总本地(清单) {
  return 汇总(清单);
}

// 本地汇总 + 系统各店 → 对比结果（纯函数，不碰浏览器）
function 对比(本地汇总, 系统各店, 匹配器, 选项 = {}) {
  const 结果 = {
    生成时间: new Date().toISOString(),
    运行日期: 选项.运行日期 || "",
    年月: 选项.年月 || 本地汇总?.年月 || "",
    系统来源: 选项.系统来源 || "新页",
    口径: "本地 = 促成订单导出（去已取消 / 昵称去(推算) / 整行去重，0 元行保留）→ Σ(单价×数量)；系统 = 客服管家「促成下单商品金额」",
    金额口径说明: "金额_单价乘数量 = Σ(商品单价×购买数量)；金额_单价直和 = Σ商品单价（不看数量）",
    stores: [],
    总计: {},
    超阈值: []
  };
  const 已校 = [];
  for (const 系 of 系统各店) {
    const 本 = (本地汇总?.stores || []).find((s) => s.store === 系.store) || null;
    const 本地客服 = new Map((本?.客服 || []).map((c) => [c.客服, c]));
    const 店 = {
      key: 系.key, store: 系.store, 状态: 系.状态,
      原因: 系.原因 || "",
      本地入库行数: 本 ? 本.入库行数 : 0,
      本地合计_单价乘数量: 本 ? 本.金额_单价乘数量 : 0,
      本地合计_单价直和: 本 ? 本.金额_单价直和 : 0,
      系统合计_促成下单: null,
      系统合计_24h未取消: null,
      差_本地减系统: null,
      差异率: null,
      超阈值: false,
      页面校验: 系.页面校验 || null,
      未匹配系统客服: [],
      仅本地方有: [],
      客服明细: []
    };
    if (系.状态 !== "已校到") {
      店.客服明细 = [...本地客服.values()].map((c) => ({
        客服: c.客服, 系统昵称: "", 本地行数: c.行数,
        本地金额_单价乘数量: c.金额_单价乘数量, 本地金额_单价直和: c.金额_单价直和,
        系统金额_促成下单: null, 系统金额_24h未取消: null, 系统订单数: null, 系统商品数: null,
        差_本地减系统: null, 差异率: null, 超阈值: false
      }));
      结果.stores.push(店);
      continue;
    }
    const 系统实名 = new Map();
    for (const r of 系.rows || []) {
      const 实名 = 匹配器.匹配(r.waiter);
      if (!实名) { 店.未匹配系统客服.push({ waiter: r.waiter, 金额: 金额(r.orderSalePrice) }); continue; }
      const 记 = 系统实名.get(实名) || { 金额: 0, 金额24h: 0, 订单数: 0, 商品数: 0, 昵称: [] };
      记.金额 += 金额(r.orderSalePrice);
      记.金额24h += 金额(r.twentyFourNotCanceledOrderSalePrice);
      记.订单数 += 金额(r.orderNum);
      记.商品数 += 金额(r.orderWareNum);
      记.昵称.push(r.waiter);
      系统实名.set(实名, 记);
    }
    const 实名并集 = new Set([...本地客服.keys(), ...系统实名.keys()]);
    for (const 实名 of 实名并集) {
      const 本记 = 本地客服.get(实名) || null;
      const 系记 = 系统实名.get(实名) || null;
      const 本地金额 = 本记 ? 到分(本记.金额_单价乘数量) : 0;
      const 系统金额 = 系记 ? 到分(系记.金额) : 0;
      const 差 = 到分(本地金额 - 系统金额);
      const 差异率 = 算差异率(本地金额, 系统金额);
      const 超 = 超阈值(本地金额, 系统金额);
      const 明细 = {
        客服: 实名, 系统昵称: 系记 ? 系记.昵称.join("、") : "",
        本地行数: 本记 ? 本记.行数 : 0,
        本地金额_单价乘数量: 本地金额,
        本地金额_单价直和: 本记 ? 本记.金额_单价直和 : 0,
        系统金额_促成下单: 系统金额,
        系统金额_24h未取消: 系记 ? 到分(系记.金额24h) : 0,
        系统订单数: 系记 ? 系记.订单数 : 0,
        系统商品数: 系记 ? 系记.商品数 : 0,
        差_本地减系统: 差, 差异率, 超阈值: 超
      };
      店.客服明细.push(明细);
      if (超) 结果.超阈值.push({ key: 系.key, store: 系.store, ...明细 });
    }
    店.客服明细.sort((a, b) => b.本地金额_单价乘数量 - a.本地金额_单价乘数量 || String(a.客服).localeCompare(String(b.客服), "zh"));
    店.仅本地方有 = [...本地客服.values()]
      .filter((c) => !系统实名.has(c.客服))
      .map((c) => ({ 客服: c.客服, 本地行数: c.行数, 本地金额_单价乘数量: c.金额_单价乘数量 }));
    const 系统总览 = 系.总览 || {};
    const 系统合计 = 到分(金额(系统总览.orderSalePrice));
    const 本地合计 = 到分(店.本地合计_单价乘数量);
    店.系统合计_促成下单 = 系统合计;
    店.系统合计_24h未取消 = 到分(金额(系统总览.twentyFourNotCanceledOrderSalePrice));
    店.差_本地减系统 = 到分(本地合计 - 系统合计);
    店.差异率 = 算差异率(本地合计, 系统合计);
    店.超阈值 = 超阈值(本地合计, 系统合计);
    if (店.超阈值) {
      结果.超阈值.push({
        key: 系.key, store: 系.store, 客服: "(店合计)", 系统昵称: "",
        本地行数: 店.本地入库行数, 本地金额_单价乘数量: 本地合计, 本地金额_单价直和: 店.本地合计_单价直和,
        系统金额_促成下单: 系统合计, 系统金额_24h未取消: 店.系统合计_24h未取消,
        系统订单数: null, 系统商品数: null,
        差_本地减系统: 店.差_本地减系统, 差异率: 店.差异率, 超阈值: true
      });
    }
    结果.stores.push(店);
    已校.push(店);
  }
  结果.总计 = {
    店数: 结果.stores.length,
    已校店数: 已校.length,
    跳过系统店数: 结果.stores.filter((s) => s.状态 === "跳过系统").length,
    未校到店: 结果.stores.filter((s) => s.状态 === "未校到").map((s) => s.key),
    本地合计_全部店: 到分(结果.stores.reduce((s, r) => s + r.本地合计_单价乘数量, 0)),
    本地合计_单价乘数量: 到分(已校.reduce((s, r) => s + r.本地合计_单价乘数量, 0)),
    本地合计_单价直和: 到分(已校.reduce((s, r) => s + r.本地合计_单价直和, 0)),
    系统合计_促成下单: 到分(已校.reduce((s, r) => s + (r.系统合计_促成下单 || 0), 0)),
    差_本地减系统: 到分(已校.reduce((s, r) => s + (r.差_本地减系统 || 0), 0))
  };
  结果.总计.差异率 = 算差异率(结果.总计.本地合计_单价乘数量, 结果.总计.系统合计_促成下单);
  结果.总计.超阈值 = 超阈值(结果.总计.本地合计_单价乘数量, 结果.总计.系统合计_促成下单);
  结果.总计.超阈值条数 = 结果.超阈值.length;
  return 结果;
}

function 率文本(率) {
  return 率 === null || 率 === undefined ? "—（系统为0）" : `${率}%`;
}

function 生成Markdown(结果) {
  const 行 = [];
  行.push(`# 31号 ${结果.年月} 金额校对：本地 ⇄ 系统（每客服）${结果.运行日期}`);
  行.push("");
  行.push(`- 系统来源：${结果.系统来源}；口径：${结果.口径}`);
  行.push(`- 总计（${结果.总计.店数} 店，已校 ${结果.总计.已校店数}）` +
    (结果.总计.已校店数
      ? `：本地 ¥${结果.总计.本地合计_单价乘数量}（直和 ¥${结果.总计.本地合计_单价直和}） / 系统 ¥${结果.总计.系统合计_促成下单}；差 ¥${结果.总计.差_本地减系统}（${率文本(结果.总计.差异率)}）`
      : `：本地（全部店）¥${结果.总计.本地合计_全部店}`));
  if (结果.总计.未校到店.length) 行.push(`- ⚠ 未校到店铺：${结果.总计.未校到店.join("、")}`);
  行.push("");
  for (const 店 of 结果.stores) {
    if (店.状态 === "未校到") {
      行.push(`## ${店.store}：未校到（${店.原因}）`);
      if (店.客服明细.length) {
        行.push("");
        行.push("| 客服 | 本地行数 | 本地金额(单价×数量) | 本地金额(单价直和) |");
        行.push("|---|---:|---:|---:|");
        for (const c of 店.客服明细) 行.push(`| ${c.客服} | ${c.本地行数} | ${c.本地金额_单价乘数量} | ${c.本地金额_单价直和} |`);
      }
      行.push("");
      continue;
    }
    if (店.状态 === "跳过系统") {
      行.push(`## ${店.store}（跳过系统；本地 ${店.本地入库行数} 行 ¥${店.本地合计_单价乘数量}）`);
    } else {
      行.push(`## ${店.store}（本地 ${店.本地入库行数} 行 ¥${店.本地合计_单价乘数量} / 系统 ¥${店.系统合计_促成下单}；` +
        `差 ¥${店.差_本地减系统}，${率文本(店.差异率)}）`);
    }
    if (店.页面校验 && 店.页面校验.状态 !== "失败") {
      行.push(`- 页面截图校验：日期=${(店.页面校验.日期值 || []).join("~")}，页面总值 ¥${店.页面校验.页面总值金额}，` +
        `与接口一致=${店.页面校验.与接口一致}（${店.页面校验.截图}）`);
    } else if (店.页面校验 && 店.页面校验.状态 === "失败") {
      行.push(`- ⚠ 页面截图校验失败：${店.页面校验.原因}`);
    }
    行.push("");
    行.push("| 客服 | 本地行数 | 本地金额(单价×数量) | 本地金额(单价直和) | 系统促成下单金额 | 差 | 差异率 |");
    行.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const c of 店.客服明细) {
      const 标 = c.超阈值 ? " ⚠" : "";
      const 系统 = c.系统金额_促成下单 === null ? "—" : c.系统金额_促成下单;
      const 差 = c.差_本地减系统 === null ? "—" : c.差_本地减系统;
      行.push(`| ${c.客服} | ${c.本地行数} | ${c.本地金额_单价乘数量} | ${c.本地金额_单价直和} | ${系统} | ${差} | ${率文本(c.差异率)}${标} |`);
    }
    if (店.未匹配系统客服.length) 行.push(`\n- 系统侧未匹配到实名的客服：${店.未匹配系统客服.map((x) => `${x.waiter}(¥${x.金额})`).join("、")}`);
    if (店.仅本地方有.length) 行.push(`- 仅本地有的客服：${店.仅本地方有.map((x) => `${x.客服}(${x.本地行数}行 ¥${x.本地金额_单价乘数量})`).join("、")}`);
    行.push("");
  }
  行.push(`## ⚠ 差异率 ≥1% 项（${结果.超阈值.length} 条）`);
  if (!结果.超阈值.length) 行.push("- 无");
  for (const x of 结果.超阈值) {
    行.push(`- ${x.store}·${x.客服}：本地 ¥${x.本地金额_单价乘数量} / 系统 ¥${x.系统金额_促成下单}，` +
      `差 ${x.差_本地减系统 >= 0 ? "+" : ""}${x.差_本地减系统}（${率文本(x.差异率)}）`);
  }
  行.push("");
  return 行.join("\n");
}

function 打印控制台(结果) {
  console.log(`\n———— 对比结果（系统来源=${结果.系统来源}；⚠=差异率≥1%）————`);
  for (const 店 of 结果.stores) {
    if (店.状态 === "未校到") {
      console.log(`\n${店.store}：未校到（${店.原因}）`);
      continue;
    }
    if (店.状态 === "跳过系统") {
      console.log(`\n${店.store}：跳过系统；本地 ${店.本地入库行数} 行 ¥${店.本地合计_单价乘数量}`);
    } else {
      console.log(`\n${店.store}：本地 ${店.本地入库行数} 行 ¥${店.本地合计_单价乘数量} / 系统 ¥${店.系统合计_促成下单}；` +
        `差 ¥${店.差_本地减系统}，${率文本(店.差异率)}`);
    }
    console.log(`  客服        行数  本地(乘)      本地(和)      系统促成      差           差异率`);
    for (const c of 店.客服明细) {
      const 标 = c.超阈值 ? " ⚠" : "";
      const 系统 = c.系统金额_促成下单 === null ? "—" : String(c.系统金额_促成下单);
      const 差 = c.差_本地减系统 === null ? "—" : String(c.差_本地减系统);
      console.log(`  ${String(c.客服).padEnd(8, "　")}  ${String(c.本地行数).padStart(4)}  ` +
        `${String(c.本地金额_单价乘数量).padEnd(11)}  ${String(c.本地金额_单价直和).padEnd(11)}  ` +
        `${系统.padEnd(11)}  ${差.padEnd(11)}  ${率文本(c.差异率)}${标}`);
    }
  }
  console.log(`\n———— 总计（${结果.总计.店数} 店，已校 ${结果.总计.已校店数}，未校到 ${结果.总计.未校到店.length}）————`);
  if (结果.总计.已校店数) {
    console.log(`  本地（全部店）¥${结果.总计.本地合计_全部店}；已校店：本地 ¥${结果.总计.本地合计_单价乘数量}` +
      `（直和 ¥${结果.总计.本地合计_单价直和}） / 系统 ¥${结果.总计.系统合计_促成下单}；差 ¥${结果.总计.差_本地减系统}（${率文本(结果.总计.差异率)}）`);
  } else {
    console.log(`  本地（全部店）¥${结果.总计.本地合计_全部店}`);
  }
  console.log(`\n———— ⚠ 差异率 ≥1% 项（${结果.超阈值.length} 条）————`);
  if (!结果.超阈值.length) console.log("  无");
  for (const x of 结果.超阈值) {
    console.log(`  ${x.store}·${x.客服}：本地 ¥${x.本地金额_单价乘数量} / 系统 ¥${x.系统金额_促成下单}，` +
      `差 ${x.差_本地减系统 >= 0 ? "+" : ""}${x.差_本地减系统}（${率文本(x.差异率)}）`);
  }
}

function 今天() {
  const d = new Date();
  const 两 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${两(d.getMonth() + 1)}-${两(d.getDate())}`;
}

// —————————————— 本地清单 ——————————————

function 读清单(本地文件, 年月, 指定店) {
  const 默认 = path.join(项目根, "runtime", "downloads", 年月);
  const 路径 = path.resolve(本地文件 || 默认);
  let 清单路径 = 路径;
  if (fs.existsSync(路径) && fs.statSync(路径).isDirectory()) 清单路径 = path.join(路径, "manifest.json");
  if (!fs.existsSync(清单路径)) throw new Error(`找不到清单：${清单路径}（--本地文件 给目录或 manifest.json）`);
  const 清单 = 归一清单(JSON.parse(fs.readFileSync(清单路径, "utf8")));
  if (!清单.yearMonth) 清单.yearMonth = 年月;
  if (!清单.files.length) throw new Error(`清单里没有文件：${清单路径}`);
  if (指定店) {
    清单.files = 清单.files.filter((f) => f.key === 指定店 || f.store === 指定店);
    if (!清单.files.length) throw new Error(`清单里没有店铺 ${指定店}（有：${归一清单(JSON.parse(fs.readFileSync(清单路径, "utf8"))).files.map((f) => f.key || f.store).join("、")}）`);
  }
  return { 清单, 清单路径 };
}

// —————————————— 系统侧（只读） ——————————————

async function 取新系统一页(page, { start, end, pageNo, pageSize }) {
  return page.evaluate(async ({ start, end, pageNo, pageSize }) => {
    const body = new URLSearchParams({
      startTime: start, endTime: end, transferType: "1", tabType: "waiterDim",
      page: String(pageNo), pageSize: String(pageSize)
    });
    const res = await fetch("https://kf.jd.com/jingmai/T1/queryIndicatorDim", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* 留原文 */ }
    return { ok: res.ok, status: res.status, json, 前200字: text.slice(0, 200) };
  }, { start, end, pageNo, pageSize });
}

async function 读新系统统计(page, { start, end }) {
  const 接口 = "kf.jd.com/jingmai/T1/queryIndicatorDim";
  const 首 = await 取新系统一页(page, { start, end, pageNo: 1, pageSize: 500 });
  if (!首.ok || !首.json) throw new Error(`接口失败 HTTP ${首.status}：${首.前200字}`);
  if (首.json.code && 首.json.code !== "success") throw new Error(`接口返回 code=${首.json.code}：${首.前200字}`);
  if (!首.json.pageData && !首.json.total) throw new Error(`接口没返回 pageData/total（疑似未登录）：${首.前200字}`);
  const 分页 = 首.json.pageData || {};
  let 全部 = 分页.result || [];
  const 页数 = Math.max(1, Number(分页.pageCount || 1));
  for (let p = 2; p <= 页数; p += 1) {
    const 次 = await 取新系统一页(page, { start, end, pageNo: p, pageSize: 500 });
    if (!次.ok || !次.json) throw new Error(`第 ${p} 页失败 HTTP ${次.status}：${次.前200字}`);
    全部 = 全部.concat((次.json.pageData || {}).result || []);
  }
  return { 接口, 页数, rows: 全部, 总览: 首.json.total || {}, 原始: 首.json };
}

async function 取旧系统一页(page, { start, end, pageNo, pageSize }) {
  const url = `https://kf.jd.com/waiterContrast/sales/queryList?startTime=${start}&endTime=${end}&page=${pageNo}&pageSize=${pageSize}`;
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: "include" });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* 留原文 */ }
    return { ok: res.ok, status: res.status, json, 前200字: text.slice(0, 200) };
  }, url);
}

async function 读旧系统统计(page, { start, end }) {
  const 接口 = "kf.jd.com/waiterContrast/sales/queryList";
  const 首 = await 取旧系统一页(page, { start, end, pageNo: 1, pageSize: 500 });
  if (!首.ok || !首.json) throw new Error(`接口失败 HTTP ${首.status}：${首.前200字}`);
  if (首.json.code && 首.json.code !== "success") throw new Error(`接口返回 code=${首.json.code}：${首.前200字}`);
  const 容器 = 首.json.data || 首.json;
  const 行 = 容器.salesList || 容器.list || 容器.records || 容器.rows || (Array.isArray(容器) ? 容器 : []);
  const 页数 = Math.max(1, Number(容器.totalPage || 1));
  let 全部 = 行;
  for (let p = 2; p <= 页数; p += 1) {
    const 次 = await 取旧系统一页(page, { start, end, pageNo: p, pageSize: 500 });
    if (!次.ok || !次.json) throw new Error(`第 ${p} 页失败 HTTP ${次.status}：${次.前200字}`);
    const c = 次.json.data || 次.json;
    全部 = 全部.concat(c.salesList || c.list || c.records || c.rows || (Array.isArray(c) ? c : []));
  }
  return { 接口, 页数, rows: 全部, 总览: 首.json.total || 容器.total || {}, 原始: 首.json };
}

// —— 页面证据（只读：设查询条件 + 点查询 + 截图 + 读表格；best-effort，失败不影响接口数字）——

async function 设新页范围(page, start, end) {
  const 起 = new Date(`${start}T00:00:00`);
  const 止 = new Date(`${end}T00:00:00`);
  const 头匹配 = (年, 月) => new RegExp(`${年}\\s*年\\s*${月}\\s*月`);
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await 睡觉(400);
  const 输入们 = page.locator('input[placeholder="开始日期"]');
  const 个数 = await 输入们.count();
  if (!个数) throw new Error("新页找不到「开始日期」输入框");
  await (个数 > 1 ? 输入们.nth(1) : 输入们.first()).click();
  await page.waitForTimeout(1200);
  const 读头 = () => page.evaluate(() => {
    const p = document.querySelector(".kf-manage-lite-picker-panels .kf-manage-lite-picker-panel .kf-manage-lite-picker-header-view");
    return p ? p.innerText.replace(/\s+/g, "") : "";
  });
  let 好了 = false;
  for (let i = 0; i < 36; i += 1) {
    const t = await 读头();
    if (头匹配(起.getFullYear(), 起.getMonth() + 1).test(t)) { 好了 = true; break; }
    const m = /(\d{4})年(\d{1,2})月/.exec(t);
    if (!m) throw new Error(`读不到新页日历头：${t}`);
    const 差 = (Number(m[1]) * 12 + Number(m[2])) - (起.getFullYear() * 12 + 起.getMonth() + 1);
    const 选 = 差 > 0 ? ".kf-manage-lite-picker-header-prev-btn" : ".kf-manage-lite-picker-header-next-btn";
    await page.locator(选).first().click();
    await 睡觉(350);
  }
  if (!好了) throw new Error(`新页日历没走到 ${起.getFullYear()}年${起.getMonth() + 1}月`);
  const 点日 = (d) => page.evaluate((d) => {
    const panel = document.querySelector(".kf-manage-lite-picker-panels .kf-manage-lite-picker-panel");
    if (!panel) return false;
    for (const c of [...panel.querySelectorAll(".kf-manage-lite-picker-cell")]) {
      if ((c.innerText || "").trim() !== String(d)) continue;
      if (/disabled/.test(c.className) || !/in-view/.test(c.className)) continue;
      const 内 = c.querySelector(".kf-manage-lite-picker-cell-inner") || c;
      内.click(); return true;
    }
    return false;
  }, d);
  if (!(await 点日(起.getDate()))) throw new Error(`点不到开始日 ${起.getDate()}`);
  await 睡觉(700);
  if (!(await 点日(止.getDate()))) throw new Error(`点不到结束日 ${止.getDate()}`);
  await 睡觉(700);
  const 值 = await page.evaluate(() => [...document.querySelectorAll('input[placeholder="开始日期"], input[placeholder="结束日期"]')].map((i) => i.value));
  const 表格对 = 值.slice(-2);
  if (表格对[0] !== start || 表格对[1] !== end) throw new Error(`新页日期没设对：全部=${JSON.stringify(值)}`);
  return 表格对;
}

async function 设旧页范围(page, start, end) {
  const 起 = new Date(`${start}T00:00:00`); const 止 = new Date(`${end}T00:00:00`);
  const 年月 = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月`;
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await 睡觉(400);
  await page.locator("input.ant-calendar-range-picker-input").first().click();
  await 睡觉(800);
  const 读头 = () => page.evaluate(() => (document.querySelector(".ant-calendar-range .ant-calendar-header") || {}).innerText || "");
  let 已对齐 = false;
  for (let i = 0; i < 36; i += 1) {
    const t = await 读头();
    if (t.includes(年月(起))) { 已对齐 = true; break; }
    const m = /(\d{4})年(\d{1,2})月/.exec(t);
    if (!m) throw new Error(`读不到日历面板头：${t}`);
    const 差 = (Number(m[1]) * 12 + Number(m[2])) - (起.getFullYear() * 12 + 起.getMonth() + 1);
    const 选 = 差 > 0 ? ".ant-calendar-range .ant-calendar-prev-month-btn" : ".ant-calendar-range .ant-calendar-next-month-btn";
    await page.locator(选).first().click();
    await 睡觉(250);
  }
  if (!已对齐) throw new Error(`日历没走到 ${年月(起)}`);
  const 点日 = (d) => page.evaluate((d) => {
    for (const s of [...document.querySelectorAll(".ant-calendar-date")]) {
      if (s.innerText.trim() !== String(d)) continue;
      const td = s.closest("td");
      if (!td || /last-month-cell|next-month-cell|disabled-cell/.test(td.className)) continue;
      s.click(); return td.className;
    }
    return null;
  }, d);
  if (!(await 点日(起.getDate()))) throw new Error(`点不到开始日 ${起.getDate()}`);
  await 睡觉(600);
  if (!(await 点日(止.getDate()))) throw new Error(`点不到结束日 ${止.getDate()}`);
  await 睡觉(600);
  const 值 = await page.evaluate(() => [...document.querySelectorAll("input.ant-calendar-range-picker-input")].map((i) => i.value));
  if (值[0] !== start || 值[1] !== end) throw new Error(`日期没设对：${JSON.stringify(值)}`);
  return 值;
}

async function 点查询(page) {
  const 点了 = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").replace(/\s/g, "") === "查询");
    if (b) { b.click(); return true; }
    return false;
  });
  if (!点了) throw new Error("没找到「查询」按钮");
}

async function 读页面表格(page) {
  return page.evaluate(() => {
    const 全部行 = [];
    for (const 表 of document.querySelectorAll("table")) {
      for (const tr of 表.querySelectorAll("tr")) {
        全部行.push([...tr.querySelectorAll("th,td")].map((c) => (c.innerText || "").trim()));
      }
    }
    const 头 = 全部行.findIndex((r) => String(r[0] || "").replace(/\s/g, "") === "客服");
    const 表头 = 头 >= 0 ? 全部行[头] : (全部行[0] || []);
    const 行 = 全部行.slice(头 >= 0 ? 头 + 1 : 1).filter((r) => r.some((v) => v) && String(r[0] || "").replace(/\s/g, "") !== "客服");
    return { 表头, 行 };
  });
}

function 页面校验(表, 系统金额) {
  const 表头 = 表.表头 || [];
  const 列 = 表头.findIndex((h) => String(h).includes("促成下单商品金额"));
  const 总值 = (表.行 || []).find((r) => String(r[0] || "").trim() === "总值");
  const 页金额 = 列 >= 0 && 总值 ? 金额(总值[列]) : null;
  return {
    页面总值金额: 页金额,
    与接口一致: 页金额 === null ? null : Math.abs(页金额 - 到分(系统金额)) < 0.01
  };
}

async function 留失败截图(page, 目录, key, 标签) {
  try {
    fs.mkdirSync(目录, { recursive: true });
    const 文件 = path.join(目录, `${key}_失败-${标签}-${Date.now()}.png`);
    await page.screenshot({ path: 文件, fullPage: false });
    return path.basename(文件);
  } catch (e) {
    return null;
  }
}

async function 页面证据(page, 来源, start, end, 目录, 店铺, 系统金额) {
  const 值 = 来源 === "旧页" ? await 设旧页范围(page, start, end) : await 设新页范围(page, start, end);
  await 点查询(page);
  await 睡觉(8000);
  const 表 = await 读页面表格(page);
  const 图片 = path.join(目录, `${店铺.key}_${来源 === "旧页" ? "销售绩效对比" : "新页店铺数据"}_${start}_${end}.png`);
  await page.screenshot({ path: 图片, fullPage: true });
  const 表文件 = path.join(目录, `${店铺.key}_${来源 === "旧页" ? "页面表格" : "新页表格"}_${start}_${end}.json`);
  const 校验 = 页面校验(表, 系统金额);
  fs.writeFileSync(表文件, JSON.stringify({
    生成时间: new Date().toISOString(), store: 店铺.key, displayName: 店铺.displayName,
    url: page.url(), 日期值: 值, 截图: path.basename(图片), 表, 校验
  }, null, 1), "utf8");
  return { 截图: path.basename(图片), 表格: path.basename(表文件), 日期值: 值, ...校验 };
}

// 只读校一家店：开（附）浏览器 → 登录/滑块检查 → 读接口 → 页面截图证据（best-effort）
async function 校一家店(店铺, { 来源, start, end, 输出目录, 不截图 }) {
  const url = 来源 === "旧页" ? 旧页URL : 新页URL;
  const session = await engine.openStoreBrowser({ profileDir: 店铺.profileDir, targetUrl: url, debugPort: 店铺.port, keepOpen: true });
  const page = session.page || await engine.firstPage(session.context, url);
  await page.bringToFront().catch(() => {});
  await 睡觉(8000);
  const 文本 = await page.evaluate(() => document.body.innerText).catch(() => "");
  const 系统目录 = path.join(输出目录, "系统方");
  fs.mkdirSync(系统目录, { recursive: true });
  if (/passport\.jd\.com|\/login/i.test(page.url()) || /请登录|欢迎登录|账号登录/.test(文本)) {
    await 留失败截图(page, 系统目录, 店铺.key, "登录失效");
    throw new Error(`【需要人工】${店铺.displayName} 登录失效（${page.url()}），窗口已留下`);
  }
  if (/滑动|验证码|安全验证/.test(文本)) {
    await 留失败截图(page, 系统目录, 店铺.key, "滑块");
    throw new Error(`【需要人工】${店铺.displayName} 出现滑块/验证码/安全验证`);
  }
  const 系统 = 来源 === "旧页" ? await 读旧系统统计(page, { start, end }) : await 读新系统统计(page, { start, end });
  const 前缀 = 来源 === "旧页" ? "销售绩效" : "新系统每人数据";
  const 接口文件 = path.join(系统目录, `${店铺.key}_${前缀}_${start}_${end}.json`);
  fs.writeFileSync(接口文件, JSON.stringify({
    生成时间: new Date().toISOString(), store: 店铺.key, displayName: 店铺.displayName,
    接口: 系统.接口, start, end, 页数: 系统.页数, 总览: 系统.总览, rows: 系统.rows, 原始: 系统.原始
  }, null, 1), "utf8");
  let 页面 = null;
  if (!不截图) {
    try {
      页面 = await 页面证据(page, 来源, start, end, 系统目录, 店铺, 金额(系统.总览.orderSalePrice));
    } catch (e) {
      页面 = { 状态: "失败", 原因: e.message };
      const 截图 = await 留失败截图(page, 系统目录, 店铺.key, "页面证据失败");
      if (截图) 页面.截图 = 截图;
    }
  }
  return {
    key: 店铺.key, displayName: 店铺.displayName, store: 店铺.displayName, 状态: "已校到",
    接口: 系统.接口, 页数: 系统.页数, rows: 系统.rows, 总览: 系统.总览, 页面校验: 页面
  };
}

// —————————————— 主流程 ——————————————

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (参数.帮助) { 用法(); return; }
  const { start, end } = 解析年月(参数.年月);
  const { 清单, 清单路径 } = 读清单(参数.本地文件, 参数.年月, 参数.store);
  const 输出目录 = path.resolve(参数.输出 || path.join(项目根, "runtime", `校对-${参数.年月}`));
  fs.mkdirSync(输出目录, { recursive: true });
  console.log(`31号 金额校对：年月=${参数.年月}（${start}~${end}）；清单=${清单路径}；` +
    `系统来源=${参数.跳过系统 ? "(跳过)" : 参数.系统来源}；输出=${输出目录}`);

  console.log(`\n———— 本地汇总（${清单.files.length} 店）————`);
  const 本地 = 汇总本地(清单);
  fs.writeFileSync(path.join(输出目录, "本地方-按客服汇总.json"), JSON.stringify(本地, null, 1), "utf8");

  const 全部店 = 全部店铺();
  const 系统各店 = [];
  const 需要人工 = [];
  const 匹配器 = 参数.跳过系统 ? { 匹配: () => "" } : 建匹配器(读映射缓存({ 映射缓存: "" }).数据);
  if (参数.跳过系统) {
    for (const f of 清单.files) {
      const 配置 = 全部店.find((s) => s.key === f.key || s.displayName === f.store);
      系统各店.push({ key: (配置 && 配置.key) || f.key || f.store, store: f.store, 状态: "跳过系统" });
    }
  } else {
    for (const f of 清单.files) {
      const 配置 = 全部店.find((s) => s.key === f.key || s.displayName === f.store);
      if (!配置) {
        系统各店.push({ key: f.key || f.store, store: f.store, 状态: "未校到", 原因: `stores.json 里没有店铺 ${f.key || f.store}` });
        continue;
      }
      console.log(`\n———— 系统读取：${配置.displayName}（${参数.系统来源}）————`);
      try {
        const 结果 = await 校一家店(配置, { 来源: 参数.系统来源, start, end, 输出目录, 不截图: 参数.不截图 });
        系统各店.push(结果);
        console.log(`  ${配置.displayName}：系统 ¥${到分(金额(结果.总览.orderSalePrice))}（${结果.rows.length} 个客服）；` +
          `页面校验=${结果.页面校验 ? (结果.页面校验.状态 === "失败" ? "失败：" + 结果.页面校验.原因 : `总值 ¥${结果.页面校验.页面总值金额}，与接口一致=${结果.页面校验.与接口一致}`) : "未做"}`);
      } catch (e) {
        console.error(`  ✗ ${配置.displayName} 未校到：${e.message}`);
        系统各店.push({ key: 配置.key, store: 配置.displayName, 状态: "未校到", 原因: e.message });
        if (/需要人工/.test(e.message)) 需要人工.push(`${配置.displayName}：${e.message}`);
      }
    }
  }

  const 结果 = 对比(本地, 系统各店, 匹配器, { 年月: 参数.年月, 系统来源: 参数.跳过系统 ? "跳过系统" : 参数.系统来源, 运行日期: 今天() });
  打印控制台(结果);

  const 日期 = 今天();
  const json路径 = path.join(输出目录, `对比-${日期}.json`);
  const md路径 = path.join(输出目录, `对比-${日期}.md`);
  fs.writeFileSync(json路径, JSON.stringify(结果, null, 1), "utf8");
  fs.writeFileSync(md路径, 生成Markdown(结果), "utf8");
  console.log(`\n已落盘：${json路径}\n已落盘：${md路径}`);
  console.log(`证据目录：${输出目录}`);

  if (结果.总计.未校到店.length) {
    console.log(`\n⚠ 未校到店铺：${结果.总计.未校到店.join("、")}（原因见上；不自动重试）`);
    process.exitCode = 1;
  }
  if (需要人工.length) {
    console.log(`\n【需要人工】\n${需要人工.map((s) => "  - " + s).join("\n")}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  // 附着/拉起的 CDP 连接会拖住事件循环；脚本结果已全部落盘，显式退出（照原校对脚本做法）。
  main().then(() => process.exit(process.exitCode || 0)).catch((e) => {
    console.error(`\n  失败：${e.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  解析参数, 用法, 解析年月, 金额, 到分, 算差异率, 超阈值, 归一清单, 汇总本地, 对比,
  生成Markdown, 打印控制台, 今天, 读清单, 页面校验
};
