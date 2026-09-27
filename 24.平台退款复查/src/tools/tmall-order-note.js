#!/usr/bin/env node
// 天猫卖家后台：读一个订单的「订单状态 + 卖家/客服备注原文」（只读）。
//
// 背景（2026-09-27 实测，用户要求把这条经验留下）：
//   判「已发货退款单有没有被拦截」时，平台订单备注是重要证据：
//     备注只写「88」这种标记 = 客服没做实质处理 → 要提醒；
//     备注写了「已通知拦截 / 请勿发货」等实质动作 = 处理过了（22号 判漏口径同款）。
//   工具**只抓备注原文**，判断交模型语义阅读，禁止关键词程序判。
//
// 页面：https://qn.taobao.com/home.htm/trade-platform/tp/detail?bizOrderId=<订单号>
//   （旧链 trade.taobao.com/trade/detail/trade_item_detail.htm?bizOrderId=… 会 302 到这里）
//   备注 DOM：div[class*="status-desc_new-memo"]；页面要等微应用渲染（约 8-10 秒）。
//
// 用法：
//   node src/tools/tmall-order-note.js --store tmall2 --orders 5127725413618030746
//   node src/tools/tmall-order-note.js --store tmall2 --orders-file runtime/tmall/订单号.txt --out runtime/tmall/订单备注.json
//
// 只读：只打开订单详情页读 DOM，不点任何按钮、不改任何东西。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { attachStoreBrowser, openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

const DETAIL_URL = (orderId) => `https://qn.taobao.com/home.htm/trade-platform/tp/detail?bizOrderId=${orderId}`;
const ENTRY_URL = (orderId) => `https://trade.taobao.com/trade/detail/trade_item_detail.htm?bizOrderId=${orderId}`;

function parseArgs(argv) {
  const args = { store: "tmall1" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "attach") { args.attach = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "store") args.store = value;
    else if (key === "orders") args.orders = value;
    else if (key === "orders-file") args.ordersFile = value;
    else if (key === "out") args.out = value;
  }
  return args;
}

function readOrders(args) {
  const raw = [];
  if (args.orders) raw.push(...String(args.orders).split(/[\s,，;；]+/));
  if (args.ordersFile) {
    const file = path.isAbsolute(args.ordersFile) ? args.ordersFile : projectPath(args.ordersFile);
    raw.push(...fs.readFileSync(file, "utf8").split(/[\s,，;；]+/));
  }
  return Array.from(new Set(raw.map((s) => s.trim()).filter((s) => /^\d{6,30}$/.test(s))));
}

function stamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function readNote(page, orderId) {
  await page.goto(ENTRY_URL(orderId), { waitUntil: "domcontentloaded", timeout: 45000 });
  // 等微应用渲染出订单信息（实测约 8-10 秒）
  await page.waitForFunction(
    () => document.body.innerText.includes("订单编号"),
    { timeout: 45000 }
  ).catch(() => {});
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const text = document.body.innerText;
    const state = text.match(/订单状态[:：]\s*([^\n]+)/);
    const noteNodes = Array.from(document.querySelectorAll('div[class*="status-desc_new-memo"], div[class*="memo"]'))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    const flagNodes = Array.from(document.querySelectorAll('div[class*="flag-block"]'))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    const orderIdShown = text.match(/订单编号[:：]\s*(\d{6,30})/);
    return {
      orderIdShown: orderIdShown ? orderIdShown[1] : null,
      orderState: state ? state[1].trim() : null,
      notes: Array.from(new Set(noteNodes)),
      flags: Array.from(new Set(flagNodes)),
      pageUrl: location.href
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orders = readOrders(args);
  if (!orders.length) throw new Error("没有订单号（--orders 或 --orders-file）");
  const store = resolveStore({ platform: "tmall", store: args.store });
  log("订单备注", "开始", `${store.name || store.key}`, `${orders.length} 单`);

  let session = args.attach
    ? await attachStoreBrowser({ profileDir: store.profileDir, port: store.port })
    : null;
  if (!session) {
    session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: ENTRY_URL(orders[0]), debugPort: store.port });
  }
  const page = session.page || await session.context.newPage();

  const results = [];
  for (const orderId of orders) {
    try {
      const data = await readNote(page, orderId);
      results.push({ orderId, ok: true, ...data });
      log("订单备注", "完成", orderId, `状态 ${data.orderState || "?"} / 备注 ${JSON.stringify(data.notes)}`);
      console.log(`  ${orderId} | ${data.orderState || "?"} | 备注：${data.notes.length ? data.notes.join(" ／ ") : "(空)"}`);
    } catch (error) {
      results.push({ orderId, ok: false, error: error.message.split("\n")[0] });
      log("订单备注", "失败", orderId, error.message.split("\n")[0]);
      console.log(`  ⚠ ${orderId} 读取失败：${error.message.split("\n")[0]}`);
    }
  }
  await page.close().catch(() => {});

  const outFile = projectPath(args.out || path.join("runtime", "tmall", `订单备注-${args.store}-${stamp()}.json`));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ store: store.key, queriedAt: new Date().toISOString(), results }, null, 2), "utf8");
  console.log(`\n  落盘：${path.relative(projectPath(), outFile)}\n`);
  process.exitCode = 0;
}

main().catch((error) => {
  log("订单备注", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exitCode = 1;
});
