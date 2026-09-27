#!/usr/bin/env node
// 读抖店「售后工作台」概览（一次拿全部计数，不用一单单翻）。
//
// 判漏口径（2026-09-21 实测 douyin3 得出，对标天猫「24小时内待处理」/京东「即将超时」/拼多多「24小时内将逾期」）：
//   · **临期待处理** = 快到处理时限的售后单 → **0 就没有临近超时的**；
//   · **投诉至监管** = 消费者投诉到监管 → 必须 0；
//   · **仲裁待协商 / 仲裁待举证** = 纠纷要商家动作 → 0 才干净；
//   · 「待商家审核（未发货退款/已发货退款/退货退款/换货/补寄/维修）」= 要商家点同意/驳回的，
//     列表行自带倒计时（原文形如「22小时31分12秒后自动同意」），**时间还多就不算卡住**；
//   · 「待商家收/发货（退货待收货）」「待消费者处理（待退货）」= 在途，不算漏。
//
// 用法：node src/tools/douyin-aftersale-overview.js --store douyin3 [--out runtime/douyin/概览-douyin3.json]
// 只读：只读页面文本，不点任何「同意退款」等动作按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { log } = require("../engine/log");
const { 校验当前店 } = require("./shop-identity");

const LIST_URL = "https://fxg.jinritemai.com/ffa/merchant-aftersale-workbench/aftersale/list";
// 紧急区 + 待商家审核 + 待商家收发货 + 待消费者处理 + 纠纷
const COUNT_LABELS = [
  "投诉至监管", "临期待处理", "催售后", "重复进线",
  "未发货退款", "已发货退款", "退货退款", "换货", "补寄", "维修",
  "全部待收货/发货", "退货待收货", "换货待收货/发货", "待退货",
  "仲裁待协商", "仲裁待举证", "仲裁平台处理中"
];
const RISK_KEYS = ["投诉至监管", "临期待处理", "仲裁待协商", "仲裁待举证", "仲裁平台处理中"];

function parseArgs(argv) {
  const args = { store: "douyin3" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "store") { args.store = argv[index + 1]; index += 1; continue; }
    if (key === "out") { args.out = argv[index + 1]; index += 1; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "douyin", store: args.store });
  log("抖店概览", "开始", `${args.store}（${store.name}）`, `端口 ${store.port}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${store.port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`端口 ${store.port} 上没有窗口（先用 probe-page 拉起）`);

  const page = await context.newPage();
  const result = { store: args.store, name: store.name, checkedAt: new Date().toISOString(), url: LIST_URL, counts: {} };
  try {
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => /临期待处理|售后工作台/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(12000);
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    // 店名（页面头部）
    const shopName = await page.evaluate(() => ((document.querySelector(".headerShopName") || {}).textContent || "").trim());
    if (shopName) result.pageShopName = shopName;
    // 店铺身份：抖音共享账号两店一个 profile，窗口可能停在另一家店（2026-09-22 实测 douyin5 读到 douyin3 的数）
    result.shopIdentity = 校验当前店(store.name, shopName);
    if (!result.shopIdentity.ok) log("抖店概览", "店名不符", result.shopIdentity.理由);
    for (const label of COUNT_LABELS) {
      const matched = text.match(new RegExp(`${label.replace(/[/]/g, "\\/")}\\s*(\\d+)`));
      result.counts[label] = matched ? Number(matched[1]) : null;
    }
    const score = text.match(/服务体验分\s*(\d+)/);
    if (score) result.serviceScore = Number(score[1]);
    // 列表里的倒计时（越小越急）
    const remainList = Array.from(text.matchAll(/(\\d+)\\s*小时\\s*(\\d+)\\s*分\\s*(\\d+)\\s*秒后自动同意/g))
      .map((m) => Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60);
    if (remainList.length) {
      result.nearestAutoRefundMinutes = Math.min(...remainList);
      result.autoRefundSamples = remainList.slice(0, 6);
    }
    const total = text.match(/共\\s*(\\d+)\\s*条/);
    if (total) result.listTotal = Number(total[1]);
    log("抖店概览", "读取完成",
      `临期待处理=${result.counts["临期待处理"]} 投诉至监管=${result.counts["投诉至监管"]} 已发货退款=${result.counts["已发货退款"]} 退货待收货=${result.counts["退货待收货"]}`);
  } finally {
    await page.close().catch(() => {});
  }

  const outFile = projectPath(args.out || `runtime/douyin/概览-${args.store}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log(`\n  ${result.pageShopName || result.name}（${args.store}）抖店售后概览：`);
  if (result.shopIdentity && !result.shopIdentity.ok) {
    console.error(`\n  ✗ 当前窗口不是目标店，**本轮结论不作数**：${result.shopIdentity.理由}`);
    console.error(`    已落盘（含 shopIdentity 标记）：${path.relative(projectPath(), outFile)}\n`);
    process.exit(1);
  }
  console.log(`    紧急：${["投诉至监管", "临期待处理", "催售后", "重复进线"].map((k) => `${k} ${result.counts[k]}`).join(" ｜ ")}`);
  console.log(`    待商家审核：${["未发货退款", "已发货退款", "退货退款", "换货", "补寄", "维修"].map((k) => `${k} ${result.counts[k]}`).join(" ｜ ")}`);
  console.log(`    待商家收/发货：${["全部待收货/发货", "退货待收货", "换货待收货/发货"].map((k) => `${k} ${result.counts[k]}`).join(" ｜ ")}`);
  console.log(`    待消费者处理：${["待退货", "退货待收货"].map((k) => `${k} ${result.counts[k]}`).join(" ｜ ")}`);
  console.log(`    纠纷：${["仲裁待协商", "仲裁待举证", "仲裁平台处理中"].map((k) => `${k} ${result.counts[k]}`).join(" ｜ ")}`);
  if (result.serviceScore !== undefined) console.log(`    服务体验分：${result.serviceScore}`);
  if (result.nearestAutoRefundMinutes !== undefined) console.log(`    最紧的自动同意倒计时：${(result.nearestAutoRefundMinutes / 60).toFixed(1)} 小时`);
  const risky = RISK_KEYS.filter((key) => (result.counts[key] || 0) > 0);
  console.log(`\n  ${risky.length ? `⚠ 需要关注：${risky.map((k) => `${k} ${result.counts[k]}`).join("、")}` : "✓ 临期待处理 / 投诉至监管 / 纠纷 全为 0（无临近超时，无纠纷待办）"}`);
  const pendingReview = ["未发货退款", "已发货退款", "退货退款", "换货", "补寄", "维修"].filter((k) => (result.counts[k] || 0) > 0);
  if (pendingReview.length) console.log(`  ⓘ 待商家审核的退款/售后：${pendingReview.map((k) => `${k} ${result.counts[k]}`).join("、")}（列表有倒计时，时间还多则不算卡住）`);
  console.log(`  落盘：${path.relative(projectPath(), outFile)}\n`);
  process.exit(0);
}

main().catch((error) => {
  log("抖店概览", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
