#!/usr/bin/env node
// 读拼多多「售后工作台」概览（一次拿全部计数，不用一单单翻）。
//
// 判漏口径（2026-09-18 实测 pdd02 得出）：
//   · 拼多多售后的自动退款时限是 **7 天**（列表行原文：「（6天23时33分2秒未处理，系统将自动退款）」= 倒计时）；
//   · 平台自己在页面顶部给出 **「24小时内将逾期订单数」**——这才是判漏的等价物：**0 就没有临近逾期**；
//   · 「投诉预警」> 0 = 客服没及时解决、消费者可能投诉 → 需要处理；
//   · 「待商家处理/退货待处理」数量可以很大但倒计时还有好几天，不算漏，只用来看积压。
//
// 用法：node src/tools/pdd-aftersale-overview.js --store pdd02 [--out runtime/pdd/概览-pdd02.json]
// 只读：只读页面文本，不点任何「同意退款」等动作按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const LIST_URL = "https://mms.pinduoduo.com/aftersales/aftersale_list";
// 页面顶部「售后数据」四项 + 快速筛选的计数
const RISK_LABELS = ["24小时内将逾期订单数", "24小时内待商家举证", "24小时内平台同意退款", "24小时内将逾期工单数"];
const FILTER_LABELS = ["投诉预警", "待处理即将逾期", "待商家处理", "待举证即将逾期", "待商家举证", "买家催处理", "待买家处理", "退货待处理"];

function parseArgs(argv) {
  const args = { store: "pdd02" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "store") { args.store = argv[index + 1]; index += 1; continue; }
    if (key === "out") { args.out = argv[index + 1]; index += 1; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "pdd", store: args.store });
  log("拼多多概览", "开始", `${args.store}（${store.name}）`, `端口 ${store.port}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${store.port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`端口 ${store.port} 上没有窗口（先用 probe-page 拉起）`);

  const page = await context.newPage();
  const result = { store: args.store, name: store.name, checkedAt: new Date().toISOString(), url: LIST_URL, risk: {}, filters: {} };
  try {
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => /24小时内将逾期订单数|待商家处理/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(8000);
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    for (const label of RISK_LABELS) {
      const matched = text.match(new RegExp(`${label}\\s*(\\d+)\\s*单`));
      result.risk[label] = matched ? Number(matched[1]) : null;
    }
    for (const label of FILTER_LABELS) {
      const matched = text.match(new RegExp(`${label}\\s*(\\d+)`));
      result.filters[label] = matched ? Number(matched[1]) : null;
    }
    // 投诉预警原文（通常是「有N笔售后单存在投诉风险」）
    const warn = text.match(/有\\s*(\\d+)\\s*笔售后单存在投诉风险[^。]*/);
    if (warn) result.complaintWarningText = warn[0].slice(0, 120);
    // 列表里最紧的倒计时（越小越急）
    const remain = Array.from(text.matchAll(/(\\d+)\\s*天\\s*(\\d+)\\s*时\\s*(\\d+)\\s*分\\s*(\\d+)\\s*秒未处理/g))
      .map((m) => Number(m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 60);
    if (remain.length) { result.nearestRemainMinutes = Math.min(...remain); result.remainSamples = remain.slice(0, 6); }
    log("拼多多概览", "读取完成",
      `24h将逾期=${result.risk["24小时内将逾期订单数"]} 投诉预警=${result.filters["投诉预警"]} 待商家处理=${result.filters["待商家处理"]}`);
    // 首页兜底：列表页读不到（有的店被「售后设置」引导拦截，实测 pdd03）→ 改读首页卡片
    if (Object.values(result.risk).every((value) => value === null)) {
      result.needHomeFallback = true;
      await page.goto("https://mms.pinduoduo.com/home", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(12000);
      const homeText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
      result.home = {};
      for (const label of ["售后过期预警", "退款/售后", "待处理工单", "即将逾期发货"]) {
        const matched = homeText.match(new RegExp(`${label}\s*(\d+)`));
        result.home[label] = matched ? Number(matched[1]) : null;
      }
      log("拼多多概览", "列表页不可用→已读首页卡片", Object.entries(result.home).map(([k, v]) => `${k}=${v}`).join(" "));
    }
  } finally {
    await page.close().catch(() => {});
  }

  const outFile = projectPath(args.out || `runtime/pdd/概览-${args.store}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log(`\n  ${result.name}（${args.store}）拼多多售后概览：`);
  console.log(`    顶部售后数据：${RISK_LABELS.map((k) => `${k} ${result.risk[k]}`).join(" ｜ ")}`);
  console.log(`    快速筛选：${FILTER_LABELS.map((k) => `${k} ${result.filters[k]}`).join(" ｜ ")}`);
  if (result.nearestRemainMinutes !== undefined) {
    console.log(`    最紧的倒计时：${(result.nearestRemainMinutes / 1440).toFixed(2)} 天（自动退款倒计时）`);
  }
  const overdue = result.risk["24小时内将逾期订单数"];
  console.log(`\n  ${overdue === 0 ? "✓ 24 小时内没有将逾期的售后单（无漏处理）" : `⚠ 24 小时内有 ${overdue} 单将逾期，需要立刻处理`}`);
  if ((result.filters["投诉预警"] || 0) > 0) console.log(`  ⚠ 投诉预警 ${result.filters["投诉预警"]} 单：${result.complaintWarningText || "客服未及时解决，消费者可能投诉"}`);
  console.log(`  落盘：${path.relative(projectPath(), outFile)}\n`);
  process.exit(0);
}

main().catch((error) => {
  log("拼多多概览", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
