#!/usr/bin/env node
// 拼多多后台申诉 · 取数取证（只读）：把一单申诉要用的材料一次抓齐，落到 runtime/appeal/<订单号>/。
//
// 抓什么（全部来自平台自己的页面/接口，只读，不点任何提交按钮）：
//   1) 售后单       POST /mercury/mms/afterSales/queryList              → afterSales.json（退款额/原因/状态/后台备注）
//   2) 订单详情     https://mms.pinduoduo.com/orders/detail?sn=...      → 订单详情.txt（购买规格/实收/售后列表/备注/操作记录）
//   3) 订单快照     https://mms.pinduoduo.com/mobile-order-ssr/goods-snapshot?orderSn=...
//                                                                       → 订单快照.txt（下单时的已选规格与该规格价格，申诉关键凭证）
//   4) 售后详情     https://mms.pinduoduo.com/aftersales-ssr/detail?id=<售后单ID>&orderSn=...
//                                                                       → 售后详情-<id>.txt（申诉说明/协商详情/聊天记录）
//   5) 聊天图片     售后详情里 chat-img.pddugc.com、t00img.yangkeduo.com/chat 的图 → chat-imgs/
//   6) context.json 汇总（规格、退款、售后单列表、文件清单）
//
// 用法：
//   node src/tools/pdd-appeal-context.js --store pdd02 --order 260923-063795392132914
//   node src/tools/pdd-appeal-context.js --store pdd02 --order <单1> <单2> --skip-chat-images
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

function parseArgs(argv) {
  const args = { store: "pdd02", orders: [], skipChatImages: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--skip-chat-images") { args.skipChatImages = true; continue; }
    if (token === "--store") { args.store = argv[i + 1]; i += 1; continue; }
    if (token === "--order") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) { args.orders.push(argv[i + 1]); i += 1; }
      continue;
    }
    if (token === "--out-dir") { args.outDir = argv[i + 1]; i += 1; continue; }
  }
  return args;
}

async function fetchAfterSales(page, orderSn) {
  return page.evaluate(async (sn) => {
    const res = await fetch("/mercury/mms/afterSales/queryList", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageSize: 20, searchText: sn, pageNumber: 1, orderByCreatedAtDesc: true }),
      credentials: "include"
    });
    const json = await res.json().catch(() => null);
    return { httpStatus: res.status, json };
  }, orderSn);
}

function simplifyAfterSales(row) {
  const yuan = (v) => (v == null ? null : Number((v / 100).toFixed(2)));
  return {
    id: row.id,
    afterSalesType: row.afterSalesType,
    afterSalesTypeName: row.afterSalesTypeName ?? null,
    afterSalesStatus: row.afterSalesStatus,
    afterSalesTitle: row.afterSalesTitle ?? null,
    afterSalesReasonDesc: row.afterSalesReasonDesc ?? null,
    refundAmountYuan: yuan(row.refundAmount),
    receiveAmountYuan: yuan(row.receiveAmount),
    goodsName: row.goodsName ?? null,
    goodsSpec: row.goodsSpec ?? null,
    sellerAfterSalesShippingStatusDesc: row.sellerAfterSalesShippingStatusDesc ?? null,
    mallRemark: row.mallRemark ?? "",
    mallRemarkTagName: row.mallRemarkTagName ?? null,
    createdAt: row.createdAt ?? null,
    closeTime: row.closeTime ?? null
  };
}

function pageText(page) {
  return page.evaluate(() => (document.body.innerText || "").replace(/\n{3,}/g, "\n\n"));
}

async function collectOrder(session, store, orderSn, outRoot, skipChatImages) {
  const dir = path.join(outRoot, orderSn);
  fs.mkdirSync(dir, { recursive: true });
  const page = await session.context.newPage();
  const result = { orderSn, store: store.key, storeName: store.name, collectedAt: new Date().toISOString(), afterSales: [], chatImages: [], files: [] };
  try {
    // 1) 售后单
    await page.goto("https://mms.pinduoduo.com/aftersales/aftersale_list", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    const afterSalesRes = await fetchAfterSales(page, orderSn);
    const rows = (afterSalesRes.json?.result?.list || []).filter((row) => row.orderSn === orderSn);
    result.afterSales = rows.map(simplifyAfterSales);
    fs.writeFileSync(path.join(dir, "afterSales.json"), JSON.stringify({ httpStatus: afterSalesRes.httpStatus, rows }, null, 2), "utf8");
    result.files.push("afterSales.json");
    if (rows[0]) {
      result.goodsName = rows[0].goodsName;
      result.goodsSpec = rows[0].goodsSpec;
      log("申诉取证", orderSn, `售后单 ${rows.length} 条`, rows.map((r) => `${r.afterSalesTitle || r.afterSalesReasonDesc || "-"}¥${(r.refundAmount / 100).toFixed(2)}`).join(" / "));
    } else {
      log("申诉取证", orderSn, "售后工作台查无此单（可能只有赔付/运费类记录）");
    }

    // 2) 订单详情
    await page.goto(`https://mms.pinduoduo.com/orders/detail?sn=${orderSn}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(8000);
    fs.writeFileSync(path.join(dir, "订单详情.txt"), await pageText(page), "utf8");
    result.files.push("订单详情.txt");

    // 3) 订单快照（下单时商品描述，平台明确说「可作为判定依据」）
    await page.goto(`https://mms.pinduoduo.com/mobile-order-ssr/goods-snapshot?orderSn=${orderSn}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    fs.writeFileSync(path.join(dir, "订单快照.txt"), await pageText(page), "utf8");
    result.files.push("订单快照.txt");

    // 4/5) 每张售后单的详情 + 聊天图片
    for (const row of rows) {
      const afsPage = await session.context.newPage();
      try {
        await afsPage.goto(`https://mms.pinduoduo.com/aftersales-ssr/detail?id=${row.id}&orderSn=${orderSn}&issueFrom=1`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await afsPage.waitForTimeout(8000);
        const name = `售后详情-${row.id}.txt`;
        fs.writeFileSync(path.join(dir, name), await pageText(afsPage), "utf8");
        result.files.push(name);
        if (!skipChatImages) {
          const imgs = await afsPage.evaluate(() => [...new Set([...document.querySelectorAll("img")].map((im) => im.src).filter((u) => /chat-img\.pddugc\.com|t00img\.yangkeduo\.com\/chat/.test(u)))]);
          const imgDir = path.join(dir, "chat-imgs");
          fs.mkdirSync(imgDir, { recursive: true });
          let n = 0;
          for (const url of imgs) {
            const clean = url.split("?")[0];
            const fileName = `${String(n + 1).padStart(2, "0")}__${clean.split("/").slice(-2).join("_")}`;
            try {
              const resp = await session.context.request.get(url, { headers: { referer: afsPage.url() } });
              if (!resp.ok()) continue;
              fs.writeFileSync(path.join(imgDir, fileName), await resp.body());
              n += 1;
              result.chatImages.push(path.posix.join(orderSn, "chat-imgs", fileName));
            } catch (error) { /* 单张图失败不影响整体 */ }
          }
          log("申诉取证", orderSn, `售后单 ${row.id} 聊天图片`, `${n} 张`);
        }
      } finally {
        await afsPage.close().catch(() => {});
      }
    }
  } finally {
    await page.close().catch(() => {});
  }
  fs.writeFileSync(path.join(dir, "context.json"), JSON.stringify(result, null, 2), "utf8");
  result.files.push("context.json");
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.orders.length) throw new Error("用法：node src/tools/pdd-appeal-context.js --store pdd02 --order <订单号...>");
  const store = resolveStore({ platform: "pdd", store: args.store });
  const outRoot = args.outDir ? projectPath(args.outDir) : projectPath("runtime", "appeal");
  log("申诉取证", "开始", `${store.key}（${store.name}）`, `${args.orders.length} 单 → ${path.relative(projectPath(), outRoot)}`);

  const session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: "https://mms.pinduoduo.com/home", debugPort: store.port });
  const summary = [];
  for (const orderSn of args.orders) {
    const result = await collectOrder(session, store, orderSn, outRoot, args.skipChatImages);
    summary.push(result);
  }
  console.log("\n  === 取证完成 ===");
  for (const item of summary) {
    console.log(`  ${item.orderSn}：售后单 ${item.afterSales.length} 条，文件 ${item.files.length} 个，聊天图 ${item.chatImages.length} 张 → ${path.relative(projectPath(), path.join(outRoot, item.orderSn))}`);
    for (const afs of item.afterSales) console.log(`    · ${afs.afterSalesTitle || "-"}｜退款 ¥${afs.refundAmountYuan}｜${afs.afterSalesReasonDesc || "-"}｜备注「${(afs.mallRemark || "（空）").replace(/\s+/g, " ")}」`);
  }
  process.exit(0);
}

main().catch((error) => { console.error(`\n  失败：${error.message}\n`); process.exit(1); });
