#!/usr/bin/env node
// 读有赞「售后维权」概览（一次拿全部 tab 计数，不用一单单翻）。
//
// 判漏口径（2026-09-21 实测 youzan1 得出，对标天猫「24小时内待处理」/京东「即将超时」/拼多多「24小时内将逾期」/抖音「临期待处理」）：
//   · **待商家处理**（extra=wait_seller_todo）= 要商家审核/退款的单 → **0 就没有卡住没人管的**；
//   · **退款异常**（extra=refund_failed）→ 必须 0；
//   · **有赞客服介入中**（extra=has_involved）= 平台介入的纠纷 → 0 才干净；
//   · 「待商家收货」（等买家寄回）/「待买家处理」（等买家动作）= 在途，不算漏。
// 列表另有「超时时间」列（每单的处理时限），要逐单看时可点「查看详情」进
// `/v4/trade/refund/detail?orderNo=<订单号>&itemId=<商品ID>`。
//
// 用法：node src/tools/youzan-refund-overview.js [--out runtime/youzan/概览-youzan1.json]
// 只读：只点 tab 与筛选，不点任何同意/拒绝/退款按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const LIST_URL = "https://www.youzan.com/v4/trade/refunds";
const TABS = [
  { label: "全部", extra: "all" },
  { label: "待商家处理", extra: "wait_seller_todo" },
  { label: "待商家收货", extra: "wait_seller_receive" },
  { label: "待买家处理", extra: "wait_buyer_todo" },
  { label: "退款异常", extra: "refund_failed" },
  { label: "有赞客服介入中", extra: "has_involved" }
];
const RISK_TABS = ["待商家处理", "退款异常", "有赞客服介入中"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = { store: "youzan1" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "store") { args.store = argv[index + 1]; index += 1; continue; }
    if (key === "out") { args.out = argv[index + 1]; index += 1; }
    if (key === "port") { args.port = Number(argv[index + 1]); index += 1; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "youzan", store: args.store });
  const port = args.port || store.port;
  log("有赞概览", "开始", `${args.store}（${store.name}）`, `端口 ${port}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`端口 ${port} 上没有窗口（先用 probe-page 拉起）`);

  const page = await context.newPage();
  const result = { store: args.store, name: store.name, checkedAt: new Date().toISOString(), url: LIST_URL, counts: {} };
  try {
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => /售后维权|待商家处理/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
    await sleep(12000);
    for (const tab of TABS) {
      const clicked = await page.evaluate((label) => {
        const hits = [...document.querySelectorAll("div,span,a,li")].filter((el) => new RegExp(`^${label}`).test((el.textContent || "").trim()) && el.offsetWidth && el.children.length <= 1);
        if (hits.length) { hits[hits.length - 1].click(); return true; }
        return false;
      }, tab.label).catch(() => false);
      if (!clicked) { result.counts[tab.label] = null; continue; }
      await sleep(8500);
      const count = await page.evaluate(() => {
        const text = document.body.innerText.replace(/\s+/g, " ");
        const matched = text.match(/共\s*(\d+)\s*条/);
        return matched ? Number(matched[1]) : 0;
      });
      result.counts[tab.label] = count;
      log("有赞概览", "tab", `${tab.label} → ${count} 条`);
    }
    // 顺手抓一眼店名（账号名）
    const account = await page.evaluate(() => {
      const matched = document.body.innerText.match(/\d{11}（[^）]{1,12}）/);
      return matched ? matched[0] : "";
    }).catch(() => "");
    if (account) result.account = account;
  } finally {
    await page.close().catch(() => {});
  }

  const outFile = projectPath(args.out || `runtime/youzan/概览-${args.store}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log(`\n  ${result.name}（${args.store}）有赞售后维权概览${result.account ? ` ｜ 账号 ${result.account}` : ""}：`);
  for (const tab of TABS) console.log(`    ${tab.label}：${result.counts[tab.label]} 条`);
  const risky = RISK_TABS.filter((key) => (result.counts[key] || 0) > 0);
  console.log(`\n  ${risky.length ? `⚠ 需要关注：${risky.map((k) => `${k} ${result.counts[k]}`).join("、")}` : "✓ 待商家处理 / 退款异常 / 有赞客服介入 全为 0（无卡住单，无异常，无纠纷）"}`);
  const inTransit = ["待商家收货", "待买家处理"].filter((k) => (result.counts[k] || 0) > 0);
  if (inTransit.length) console.log(`  ⓘ 在途（不算漏）：${inTransit.map((k) => `${k} ${result.counts[k]}`).join("、")}`);
  console.log(`  落盘：${path.relative(projectPath(), outFile)}\n`);
  process.exit(0);
}

main().catch((error) => {
  log("有赞概览", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
