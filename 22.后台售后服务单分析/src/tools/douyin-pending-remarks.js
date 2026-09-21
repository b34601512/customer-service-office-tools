#!/usr/bin/env node
// 抖音「待商家处理」售后单：逐单读【订单备注】，**没备注的 = 客服还没处理 → 提醒清单**。
//
// 用户口径（2026-09-21 拍板）：
//   没备注 ≡ 还没处理 → 要提醒；有备注 ≡ 客服处理过 → 不提醒。
//（比"看倒计时"更贴业务：售后的处理动作客服会写进订单备注，如「88 已通知拦截」。）
//
// 覆盖范围：待商家审核的 6 个筛选（未发货退款/已发货退款/退货退款/换货/补寄/维修）。
// 在途（退货待收货/待退货）不属"待商家处理"，不查。
//
// 用法：node src/tools/douyin-pending-remarks.js --store douyin3 [--out runtime/douyin/待提醒-douyin3.json]
// 只读：只点筛选与「查看详情」，不点任何同意/拒绝按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const LIST_URL = "https://fxg.jinritemai.com/ffa/merchant-aftersale-workbench/aftersale/list";
const DETAIL_URL = "https://fxg.jinritemai.com/ffa/maftersale/aftersale/detail-v3?aftersale_id=";
const REVIEW_FILTERS = ["未发货退款", "已发货退款", "退货退款", "换货", "补寄", "维修"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const args = { store: "douyin3" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "store") { args.store = argv[index + 1]; index += 1; continue; }
    if (key === "out") { args.out = argv[index + 1]; index += 1; }
    // 抖音两店共用一个 profile，实际活着的窗口可能在另一家店的端口上（店里已切过店铺）
    if (key === "port") { args.port = Number(argv[index + 1]); index += 1; }
  }
  return args;
}

// 在列表页点某个快捷筛选，返回该筛选下的行（订单号/售后号/金额/原因/申请时间/倒计时）
async function collectRows(page, filterLabel, expectedCount) {
  const clicked = await page.evaluate((label) => {
    const hit = [...document.querySelectorAll("div,span,a,li")].find((el) => new RegExp(`^${label}\\s*\\d*$`).test((el.textContent || "").trim()) && el.offsetWidth);
    if (hit) { hit.click(); return true; }
    return false;
  }, filterLabel).catch(() => false);
  if (!clicked) return { rows: [], clicked: false };
  await sleep(9000);
  const rows = await page.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, " ");
    const blocks = text.split("订单编号 ").slice(1);
    return blocks.map((block) => ({
      orderId: (block.match(/^(\d{15,25})/) || [])[1] || "",
      aftersaleId: (block.match(/售后编号\s*(\d{10,20})/) || [])[1] || "",
      money: (block.match(/售后退款\s*¥\s*(\d+(?:\.\d+)?)/) || [])[1] || "",
      reason: (block.match(/申请原因\s*([^ ]{1,20})/) || [])[1] || "",
      appliedAt: (block.match(/申请时间\s*([\d/: ]{16,20})/) || [])[1] || "",
      remain: (block.match(/(\d+)\s*小时\s*(\d+)\s*分\s*(\d+)\s*秒后自动同意/) || []).slice(1, 4).join(":")
    })).filter((row) => row.orderId && row.aftersaleId);
  });
  return { rows, clicked: true, expectedCount };
}

// 逐单打开详情页读【订单备注】（空 = 还没处理）
async function readRemark(page, aftersaleId) {
  await page.goto(DETAIL_URL + aftersaleId, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await sleep(9000);
  return page.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, " ");
    if (!/售后编号/.test(text)) return { ok: false, remark: "", raw: "" };
    const matched = text.match(/订单备注：\s*(.*?)\s*修改\s/);
    const remark = matched ? matched[1].trim() : "";
    return { ok: true, remark, raw: text.slice(text.indexOf("订单备注"), text.indexOf("订单备注") + 120) };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "douyin", store: args.store });
  const port = args.port || store.port;
  log("抖音待办", "开始", `${args.store}（${store.name}）逐单读备注`, `端口 ${port}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`端口 ${port} 上没有窗口（先用 probe-page 拉起）`);

  const page = await context.newPage();
  const all = [];
  try {
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => /临期待处理/.test(document.body.innerText), { timeout: 40000 }).catch(() => {});
    await sleep(11000);

    for (const filter of REVIEW_FILTERS) {
      const { rows } = await collectRows(page, filter);
      rows.forEach((row) => all.push({ ...row, filter }));
      log("抖音待办", "筛选", `${filter}：${rows.length} 单`);
      if (rows.length === 0) continue;
      // 回到列表（详情页是独立标签，这里只需停在列表页）
      if (!/aftersale\/list/.test(page.url())) {
        await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
        await sleep(9000);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  // 去重后逐单读备注（用独立页，避免打扰列表页）
  const seen = new Set();
  const unique = all.filter((row) => (seen.has(row.orderId) ? false : (seen.add(row.orderId), true)));
  const detail = await context.newPage();
  const result = { store: args.store, name: store.name, port, checkedAt: new Date().toISOString(), total: unique.length, needRemind: [], handled: [] };
  try {
    for (const row of unique) {
      const { ok, remark } = await readRemark(detail, row.aftersaleId);
      const item = { ...row, remark, ok };
      if (ok && remark) result.handled.push(item);
      else result.needRemind.push(item);
      log("抖音待办", "读备注", `${row.orderId} → ${ok ? (remark ? `已处理「${remark.slice(0, 24)}」` : "**没备注**") : "读取失败"}`);
    }
  } finally {
    await detail.close().catch(() => {});
  }

  const outFile = projectPath(args.out || `runtime/douyin/待提醒-${args.store}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log(`\n  ${store.name}（${args.store}）待商家处理售后 ${result.total} 单：`);
  if (result.needRemind.length === 0) {
    console.log("  ✓ 全部有备注 → 客服都处理过了，无需提醒");
  } else {
    console.log(`\n  ⚠ 没备注（= 还没处理）${result.needRemind.length} 单：`);
    for (const item of result.needRemind) {
      console.log(`    · ${item.filter} ｜ 订单 ${item.orderId}（售后 ${item.aftersaleId}）¥${item.money} ｜ ${item.reason} ｜ ${item.appliedAt}${item.remain ? ` ｜ 剩 ${item.remain}` : ""}`);
    }
  }
  if (result.handled.length) {
    console.log(`\n  ✓ 有备注（已处理）${result.handled.length} 单：`);
    for (const item of result.handled) console.log(`    · 订单 ${item.orderId} → 「${item.remark.slice(0, 40)}」`);
  }
  console.log(`\n  落盘：${path.relative(projectPath(), outFile)}`);
  console.log(`  发群前必须先问用户（红线）。\n`);
  process.exit(0);
}

main().catch((error) => {
  log("抖音待办", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
