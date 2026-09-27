#!/usr/bin/env node
// 管易云 ERP 批量查订单状态（只读）——给 24号「货物安全复查」用。
//
// 原理（2026-09-27 实测，别再摸索）：
//   ERP 订单查询页 = https://v2.guanyierp.com/tc/trade/trade_order_header（iframe/frame），
//   查询接口 = POST /tc/trade/trade_order_header/data/list（form-urlencoded）。
//   批量单号编码：platformCode=单号1(enter)单号2(enter)… & separatorPlatform=3（3=逗号；
//     1=空格、2=分号、4=换行）——这是页面「批量筛选」对话框的真实编码（前端 JS 里挖出来的）。
//   单据时间 dateType：0=最近7天、1=2017年至7天以前、2=2017年以前（页面 select 的三个选项）。
//     → 一次查不全，本工具对每批单号自动查 dateType=0/1/2 三遍再合并。
//   作废过滤 cancel：false=只看未作废（默认，会漏掉作废单）、true=只看作废、**留空=不过滤（全都要）**。
//     2026-09-27 用户实测踩坑：5127668712759105946 在 ERP 里是「作废」单，
//     之前用 cancel=false 查不到，用户勾上「作废」才看到 → 本工具固定传 cancel=（空）。
//   接口返回 { total, rows:[…] }，每行含 cancel/approve/assignState/deliveryState/refund 等。
//
// 用法：
//   node src/tools/erp-order-status.js --orders 5127371102267014515,3316420742065069564
//   node src/tools/erp-order-status.js --orders runtime/tmall/订单号.txt
//   node src/tools/erp-order-status.js --orders-file runtime/tmall/订单号.txt --out runtime/erp/状态.json
//
// 只读：只 POST 查询接口，不改 ERP 任何数据。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { attachStoreBrowser, openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

const ERP_HOME = "https://v2.guanyierp.com/index";
const ORDER_FRAME_MARK = "trade_order_header";
const CHUNK_SIZE = 200;
const DATE_TYPES = [0, 1, 2];

function parseArgs(argv) {
  const args = { store: "erp1", chunk: CHUNK_SIZE };
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
    else if (key === "chunk") args.chunk = Number(value);
  }
  return args;
}

function stamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readOrders(args) {
  const raw = [];
  if (args.orders) raw.push(...String(args.orders).split(/[\s,，;；]+/));
  if (args.ordersFile) {
    const file = path.isAbsolute(args.ordersFile) ? args.ordersFile : projectPath(args.ordersFile);
    raw.push(...fs.readFileSync(file, "utf8").split(/[\s,，;；]+/));
  }
  return Array.from(new Set(raw.map((s) => s.trim()).filter((s) => /^\d{6,30}(-\d{3,30})?$/.test(s))));
}

// 确保订单查询 frame 在：没有就点左上菜单里的「订单查询」
async function ensureOrderFrame(context) {
  const findFrame = () => {
    for (const page of context.pages()) {
      const frame = page.frames().find((f) => f.url().includes(ORDER_FRAME_MARK));
      if (frame) return { page, frame };
    }
    return null;
  };
  let hit = findFrame();
  if (hit) return hit;

  const mainPage = context.pages().find((p) => p.url().includes("guanyierp.com")) || context.pages()[0];
  if (!mainPage) throw new Error("ERP 窗口里没有可用页面");
  if (/login\.guanyierp\.com/.test(mainPage.url())) {
    throw new Error("ERP 未登录（页面在 login.guanyierp.com）——请在弹出的 ERP 窗口里登录后重跑");
  }
  await mainPage.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("div,span,a,li,button"));
    const hitNode = nodes.find((el) => (el.innerText || "").trim() === "订单查询" && el.offsetParent !== null);
    if (hitNode) (hitNode.closest("a,li,button,div") || hitNode).click();
  }).catch(() => {});
  for (let waited = 0; waited < 25000; waited += 500) {
    hit = findFrame();
    if (hit) return hit;
    await sleep(500);
  }
  throw new Error("25 秒内没找到 ERP 订单查询页（trade_order_header）——请确认 ERP 已登录且窗口停在首页");
}

async function queryBatch(frame, codes, dateType) {
  const payload = [
    "page=1",
    "limit=200",
    "start=0",
    `dateType=${dateType}`,
    `platformCode=${codes.map((code) => encodeURIComponent(code)).join("(enter)")}`,
    "separatorPlatform=3",
    "hasInvoice=",
    "refund=",
    "approve=",
    "financeReject=",
    "cancel=",
    "hold="
  ].join("&");
  return frame.evaluate(async (body) => {
    const res = await fetch("/tc/trade/trade_order_header/data/list", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body
    });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return { status: res.status, total: json.total, rows: json.rows || [] };
    } catch (error) {
      return { status: res.status, error: `返回不是 JSON：${text.slice(0, 120)}` };
    }
  }, payload);
}

const ASSIGN_LABEL = { 0: "未配货", 1: "部分配货", 2: "全部配货" };
const DELIVERY_LABEL = { 0: "未发货", 1: "部分发货", 2: "全部发货" };

function pickRow(row) {
  return {
    erpCode: row.code || "",
    platformCode: row.platformCode || "",
    shopName: row.shopName || "",
    cancel: Boolean(row.cancel),
    cancelState: row.cancel ? "已作废" : "未作废",
    approve: Boolean(row.approve),
    approveState: row.approve ? "已审核" : "未审核",
    assignState: row.assignState,
    assignLabel: ASSIGN_LABEL[row.assignState] ?? String(row.assignState ?? ""),
    deliveryState: row.deliveryState,
    deliveryLabel: DELIVERY_LABEL[row.deliveryState] ?? String(row.deliveryState ?? ""),
    refund: row.refund,
    financeReject: row.financeReject,
    expressName: row.expressName || "",
    mailNo: row.mailNo || "",
    createDate: row.createDate || "",
    paytime: row.paytime || "",
    sellerMemo: row.sellerMemo || "",
    warehouseName: row.warehouseName || "",
    opState: row.opState,
    sysTradingState: row.sysTradingState,
    sysTradingStateDesc: row.sysTradingStateDesc || "",
    platformTradingStateDesc: row.platformTradingStateDesc || "",
    errorMsg: row.errorMsg || ""
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orders = readOrders(args);
  if (!orders.length) throw new Error("没有有效订单号：用 --orders <单号逗号分隔|文件路径>");
  const store = resolveStore({ platform: "erp", store: args.store });
  log("ERP查单", "开始", `${orders.length} 个订单号（端口 ${store.port}）`);

  let session = await attachStoreBrowser({ profileDir: store.profileDir, port: store.port });
  if (!session) {
    log("ERP查单", "拉起浏览器", `端口 ${store.port}`);
    session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: ERP_HOME, debugPort: store.port });
  }
  const { page, frame } = await ensureOrderFrame(session.context);
  log("ERP查单", "订单查询页", `${page.url().slice(0, 60)} | frame=${frame.url().slice(0, 60)}`);

  const byPlatformCode = new Map();
  const chunkCount = Math.ceil(orders.length / args.chunk);
  for (let start = 0; start < orders.length; start += args.chunk) {
    const codes = orders.slice(start, start + args.chunk);
    for (const dateType of DATE_TYPES) {
      const result = await queryBatch(frame, codes, dateType);
      if (result.error) {
        log("ERP查单", "查询失败", `dateType=${dateType} 批 ${start / args.chunk + 1}/${chunkCount}：${result.error}`);
        continue;
      }
      for (const row of result.rows) {
        if (!byPlatformCode.has(row.platformCode)) byPlatformCode.set(row.platformCode, pickRow(row));
      }
      log("ERP查单", "批次完成", `dateType=${dateType} ${start / args.chunk + 1}/${chunkCount} 批（${codes.length} 单）`, `命中 ${result.rows.length}`);
      await sleep(300);
    }
  }

  const found = [];
  const missing = [];
  for (const orderId of orders) {
    if (byPlatformCode.has(orderId)) found.push(byPlatformCode.get(orderId));
    else missing.push(orderId);
  }

  const output = {
    queriedAt: new Date().toISOString(),
    store: args.store,
    orderCount: orders.length,
    foundCount: found.length,
    missingCount: missing.length,
    missingOrders: missing,
    orders: found
  };
  const outFile = args.out
    ? projectPath(args.out)
    : projectPath("runtime", "erp", `ERP状态-${stamp()}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");

  console.log(`\n  ERP 查询结果（${found.length}/${orders.length} 单命中）：`);
  for (const item of found) {
    console.log(`    ${item.platformCode} | ${item.shopName} | ${item.cancelState} | ${item.approveState} | ${item.assignLabel} | ${item.deliveryLabel} | 快递 ${item.expressName || "-"} | 建单 ${item.createDate}`);
  }
  if (missing.length) console.log(`\n  ⚠ ERP 查不到的订单（${missing.length}）：${missing.join(", ")}`);
  console.log(`\n  落盘：${path.relative(projectPath(), outFile)}\n`);
  process.exit(0);
}

main().catch((error) => {
  log("ERP查单", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
