#!/usr/bin/env node
// 查拼多多「平台同意退款」的售后单（只读）。
//
// 起因（2026-09-30）：售后工作台顶部有「24小时内平台同意退款 N」这个数，但以前经验文档写的是
//   “面板不可点、无对应筛选，只能人工核”。实测**有筛选**：列表的「操作类型」里就能选
//   「平台同意退款」（请求参数 `operateType: 2`；另一个选项「平台同意退货」= 4）。
//   于是拿这个数去对账就有据可查了——本工具就是把它们列出来。
//
// 语义提醒：
//   · 时间筛选用的是**申请时间**（startCreatedTime/endCreatedTime），而面板数字说的是**近 24h 内平台同意**，
//     所以本工具拉近 N 天（默认 30）的「平台同意退款」单，再按 **closeTime（毫秒）** 标出哪些落在近 H 小时里。
//   · actions 里 `[1000]` = 秒退/极速退款（平台机制直接退），`[1028]` = 超时自动退（商家没在时限内处理）
//     —— 后者才更可能是“我们漏处理”的信号，但**要不要申诉/怎么定责由人判断**，工具只列事实。
//
// 用法：
//   node src/tools/pdd-platform-refund-orders.js --store pdd02 [--days 30] [--hours 24]
// 只读：同源 fetch 查询接口，不点任何按钮、不改任何东西。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const LIST_URL = "https://mms.pinduoduo.com/aftersales/aftersale_list";
const QUERY_LIST = "/mercury/mms/afterSales/queryList";
const 操作类型_平台同意退款 = 2;

// 纯函数：挑出 closeTime 落在「近 hours 小时」内的单（可单测）
function 筛选近内关闭(list, hours, nowMs = Date.now()) {
  const 界 = nowMs - hours * 3600 * 1000;
  return list.filter((x) => {
    const 关闭 = Number(x.closeTime) || 0;
    return 关闭 > 0 && 关闭 >= 界 && 关闭 <= nowMs;
  });
}

// 纯函数：把 actions 翻译成人看的话
function 解释actions(actions) {
  const 表 = { 1000: "秒退/极速退款（平台机制直接退）", 1028: "超时自动退（商家没在时限内处理）" };
  return (actions || []).map((a) => `${a}（${表[a] || "见后台"}）`).join("、") || "无";
}

function parseArgs(argv) {
  const args = { store: "pdd02", days: 30, hours: 24 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, "");
    if (key === "store") { args.store = argv[i + 1]; i += 1; continue; }
    if (key === "days") { args.days = Number(argv[i + 1]); i += 1; continue; }
    if (key === "hours") { args.hours = Number(argv[i + 1]); i += 1; continue; }
    if (key === "out") { args.out = argv[i + 1]; i += 1; continue; }
  }
  return args;
}

const 时分 = (ms) => (ms ? new Date(Number(ms)).toLocaleString("zh-CN", { hour12: false }) : "-");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "pdd", store: args.store });
  log("拼多多平台同意退款", "开始", `${args.store}（${store.name}）`, `端口 ${store.port}，近 ${args.days} 天`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${store.port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`端口 ${store.port} 上没有窗口（先用 probe-page 拉起）`);
  const page = context.pages()[0] || (await context.newPage());
  const 秒 = Math.floor(Date.now() / 1000);

  const 原始 = await page.evaluate(async ({ 秒, 天 }) => {
    const r = await fetch("/mercury/mms/afterSales/queryList", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageSize: 100, pageNumber: 1, orderByCreatedAtDesc: true, operateType: 2, startCreatedTime: 秒 - 天 * 86400, endCreatedTime: 秒 }),
    });
    const j = await r.json();
    if (j.errorMsg) throw new Error(`接口报错：${j.errorMsg}`);
    return (j.result && j.result.list) || [];
  }, { 秒, 天: args.days });

  const 近内 = 筛选近内关闭(原始, args.hours);
  const result = { store: args.store, name: store.name, checkedAt: new Date().toISOString(), days: args.days, hours: args.hours, total: 原始.length, 近内单: 近内 };
  const outFile = projectPath(args.out || `runtime/pdd/平台同意退款-${args.store}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log(`\n  ${store.name}（${args.store}）「平台同意退款」：近 ${args.days} 天共 ${原始.length} 单，其中近 ${args.hours} 小时关闭的 ${近内.length} 单`);
  for (const x of 近内) {
    console.log(`    ★ ${x.orderSn} ｜ ¥${(x.refundAmount / 100).toFixed(2)} ｜ ${x.afterSalesTypeName} ｜ 申请 ${时分(Number(x.createdAt) * 1000)} ｜ 关闭 ${时分(x.closeTime)}`);
    console.log(`        actions=${x.actions ? JSON.stringify(x.actions) : "-"} ⇒ ${解释actions(x.actions)}`);
  }
  if (近内.length) console.log(`\n  对照：售后工作台顶部「24小时内平台同意退款」应等于上面的单数（近 ${args.hours} 小时口径）。\n  落盘：${path.relative(projectPath(), outFile)}\n`);
  else console.log(`\n  近 ${args.hours} 小时没有「平台同意退款」的单。\n  落盘：${path.relative(projectPath(), outFile)}\n`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    log("拼多多平台同意退款", "失败", error.message);
    console.error(`\n  失败：${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { 筛选近内关闭, 解释actions, 操作类型_平台同意退款 };
