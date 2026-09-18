#!/usr/bin/env node
// 读京东「自主售后」概览（一次拿全部计数，不用一单一单看）。
//
// 判漏口径（与天猫同理）：
//   · 「即将超时」= 快到处理时限的售后单 → **0 就没有临近超时未处理的单**；
//   · 「待处理」= 需要商家动手处理的 → 0 表示没有积压；
//   · 「待收货」= 客户已寄回、等商家签收（在途，不算漏）；「催收」= 催客户寄回。
//
// 用法：node src/tools/jd-aftersale-overview.js [--store jd1] [--out runtime/jd/概览-jd1.json]
// 只读：只读页面文本，不点任何提交类按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const LIST_URL = "https://shop.jd.com/jdm/trade/after-sale/independent-after-sale/list";
const DISPUTE_URL = "https://shop.jd.com/jdm/trade/after-sale/trade-dispute/list";
const DISPUTE_LABELS = ["全部", "待回复", "待举证", "待执行", "已完成"];
const HOME_URL = "https://shop.jd.com/jdm/home";
const DISPUTE_LIST_URL = "https://shop.jd.com/jdm/trade/after-sale/trade-dispute/list";
// 首页「客服」区域的两块卡片（用户 2026-09-18 截图确认：售后 + 纠纷都要看）
const HOME_CARDS = {
  售后: ["取消订单", "待审核售后", "待收货售后", "待处理售后"],
  纠纷: ["待回复纠纷", "待举证纠纷", "待执行纠纷", "待处理赔付", "待处理工商投诉"]
};
const COUNT_LABELS = ["全部", "待审核", "待收货", "待处理", "催收", "即将超时", "催审"];

function parseArgs(argv) {
  const args = { store: "jd1" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "store") { args.store = argv[index + 1]; index += 1; continue; }
    if (key === "out") { args.out = argv[index + 1]; index += 1; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "jd", store: args.store });
  log("京东概览", "开始", `${args.store}（${store.name}）`, `端口 ${store.port}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${store.port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`端口 ${store.port} 上没有窗口（先用 probe-page 拉起）`);

  const page = await context.newPage();
  const result = { store: args.store, name: store.name, checkedAt: new Date().toISOString(), url: LIST_URL, counts: {} };
  try {
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => /即将超时|催收/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    for (const label of COUNT_LABELS) {
      const matched = text.match(new RegExp(`${label}\\s*[（(](\\d+)[)）]`));
      result.counts[label] = matched ? Number(matched[1]) : null;
    }
    result.totalText = (text.match(/共\s*(\d+)\s*条/) || [])[1] || null;
    result.finalUrl = page.url();
    log("京东概览", "售后读取完成", Object.entries(result.counts).map(([k, v]) => `${k}=${v}`).join(" "));
    // 纠纷（用户 2026-09-18 要求：待回复也要看）。列表页带 tab 计数和「还剩X小时Y分」，比首页浮层稳。
    result.disputeTabs = {};
    result.disputeRows = [];
    const disputePage = await context.newPage();
    try {
      await disputePage.goto(DISPUTE_LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
      await disputePage.waitForFunction(() => /待举证|待执行|还剩/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
      await disputePage.waitForTimeout(8000);
      const dtext = await disputePage.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
      for (const label of ["待回复", "待举证", "待执行", "可申诉", "已申诉"]) {
        const matched = dtext.match(new RegExp(`${label}\s*[（(]?\s*(\d+)`));
        result.disputeTabs[label] = matched ? Number(matched[1]) : null;
      }
      // 逐行抓「待商家处理/待商家执行」的单，连同剩余处理时间
      result.disputeRows = await disputePage.evaluate(() => {
        const rows = [];
        for (const tr of document.querySelectorAll("tr")) {
          const text = (tr.innerText || "").replace(/\s+/g, " ").trim();
          if (!/待商家|还剩/.test(text) || text.length > 400) continue;
          const remain = (text.match(/还剩\s*(?:([0-9]+)\s*天)?\s*([0-9]+)\s*小时\s*([0-9]+)\s*分/) || []);
          const id = (text.match(/(\d{7,10})/) || [])[1] || "";
          const order = (text.match(/(\d{9,20})/g) || [])[1] || "";
          const status = (text.match(/待商家[处理执行回复举证]+/) || [])[0] || "";
          rows.push({ disputeId: id, orderId: order, status, remainHours: remain[2] ? Number(remain[1] || 0) * 24 + Number(remain[2]) + Number(remain[3]) / 60 : null, raw: text.slice(0, 160) });
        }
        return rows.slice(0, 20);
      });
      result.disputeUrl = DISPUTE_LIST_URL;
      log("京东概览", "纠纷读取完成", Object.entries(result.disputeTabs).map(([k, v]) => `${k}=${v}`).join(" "), `列出的待办 ${result.disputeRows.length} 单`);
    } catch (error) {
      result.disputeError = error.message;
      log("京东概览", "纠纷读取失败", error.message);
    } finally {
      await disputePage.close().catch(() => {});
    }
  } finally {
    await page.close().catch(() => {});
  }

  console.log(`
  ${store.name} 纠纷 tab：${Object.entries(result.disputeTabs || {}).map(([k, v]) => `${k} ${v}`).join(" ｜ ") || "(未读到)"}`);
  console.log(`  纠纷明细（${(result.disputeRows || []).length} 单）：`);
  for (const row of result.disputeRows || []) {
    const remain = row.remainHours === null ? "无倒计时" : `还剩 ${row.remainHours.toFixed(1)} 小时`;
    console.log(`    · ${row.disputeId} 订单 ${row.orderId} 「${row.status}」${remain}`);
  }

  const outFile = projectPath(args.out || `runtime/jd/概览-${args.store}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  const risky = ["即将超时", "待处理"].filter((key) => (result.counts[key] || 0) > 0);
  const disputeRisky = Object.entries(result.disputeTabs || {}).filter(([label, value]) => ["待回复", "待举证", "待执行"].includes(label) && (value || 0) > 0);
  console.log(`\n  ${result.name}（${args.store}）售后概览：`);
  console.log(`    即将超时 ${result.counts["即将超时"]} ｜ 待处理 ${result.counts["待处理"]} ｜ 待审核 ${result.counts["待审核"]} ｜ 待收货 ${result.counts["待收货"]} ｜ 催收 ${result.counts["催收"]}`);
  console.log(`\n  ${risky.length ? `⚠ ${risky.join("、")} 不为 0，需要去后台看具体单` : "✓ 没有临近超时/待处理的售后单（无漏处理）"}`);
  console.log(`  落盘：${path.relative(projectPath(), outFile)}\n`);
  process.exit(0);
}

main().catch((error) => {
  log("京东概览", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
