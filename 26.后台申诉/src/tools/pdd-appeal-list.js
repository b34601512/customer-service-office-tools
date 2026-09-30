#!/usr/bin/env node
// 采集拼多多「可申诉订单」清单（只读）。
//
// 入口（2026-09-27 实测）：
//   首页「可申诉订单 N」卡片 → /orders/appeals/aftersale/order（售后申诉页）
//   页面四个 tab：维权申诉 / 订单赔偿申诉 / 极速退款申诉 / 极速换货申诉（计数相加=首页的 N）
// 数据来源：页面自己的接口（**直接同源 fetch，不点 DOM**，最稳）：
//   POST /auncel/mms/appeal/queryCanAppealInfoList
//   body: {"needCheckAppeal":true,"pageIndex":1,"pageSize":50,"subAppealQueryType":<类型>,"searchWillExpire":false,"filterNoAppealMarkAndLowPass":true}
//   subAppealQueryType：1=维权申诉、5=订单赔偿申诉、2=极速退款申诉、7=极速换货申诉
//
// 关键字段（判「货物安全」用）：
//   orderSn                              拼多多订单号（形如 260818-***********1335）
//   afterSalesId / afterSalesStatus / afterSalesType   售后单 ID / 状态 / 类型
//   refundAmount / receiveAmount         退款金额 / 实收（单位：分）
//   refundTime                           退款时间（毫秒）
//   expireRemainTime                     申诉剩余时限（毫秒）
//   sellerAfterSalesShippingStatus(Desc) 发货状态（1=已发货）
//   canCargoAppealAmount / canFreightAppealAmount      可申诉的货款/运费金额（分）
//   compensateAmount                     赔偿金额（订单赔偿申诉用，分）
//   reasonCode / reasonDesc              退款原因
//   subAppealForbiddenReasonDescMap      各子申诉是否被禁止 + 原因（如「商家同意售后退款，无法申诉」）
//
// 用法：
//   node src/tools/pdd-appeal-list.js --store pdd02
//   node src/tools/pdd-appeal-list.js --store pdd02 --tabs 1,2 --out runtime/pdd/申诉清单-pdd02.json
//   node src/tools/pdd-appeal-list.js --store pdd02 --records [--days 30]   # 查「申诉记录」（提交后的审核状态）
//
// 「申诉记录」接口（2026-09-28 实测）：POST /auncel/mms/appeal/queryList
//   body: {flowStatusList:[0..11],pageIndex,pageSize,appealSubStatus:[],onlyShowReconsiderAppeal:false,
//          onlyShowNeedAppealPicture:false,startApplyTime,endApplyTime}（时间窗口毫秒）
//   返回 result.queryAppealInfoFromEsDetailList；同一 appealId 下每条子申诉一行：
//   orderSn / appealId / appealSubId / appealTypeDesc / appealSubTypeDesc / applyTime /
//   appealSubStatusDescWithRemit（如「待处理」）/ amount / remitAmount
//
// 只读：只 GET 首页 + POST 查询接口，不点任何「发起申诉/暂不申诉」按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { attachStoreBrowser, openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

const TAB_NAMES = { 1: "维权申诉", 5: "订单赔偿申诉", 2: "极速退款申诉", 7: "极速换货申诉" };
const API_PATH = "/auncel/mms/appeal/queryCanAppealInfoList";
const RECORDS_API_PATH = "/auncel/mms/appeal/queryList";
const HOME_URL = "https://mms.pinduoduo.com/home";

function parseArgs(argv) {
  const args = { store: "pdd02", tabs: "1,5,2,7", pageSize: 50, maxPages: 20, records: false, days: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "attach") { args.attach = true; continue; }
    if (key === "records") { args.records = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "store") args.store = value;
    else if (key === "tabs") args.tabs = value;
    else if (key === "out") args.out = value;
    else if (key === "page-size") args.pageSize = Number(value);
    else if (key === "max-pages") args.maxPages = Number(value);
    else if (key === "days") args.days = Number(value);
  }
  return args;
}

function stamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalize(row, tabType) {
  const cents = (value) => (value === null || value === undefined ? null : Number((value / 100).toFixed(2)));
  const msToIso = (value) => (value ? new Date(Number(value)).toISOString() : null);
  return {
    tab: TAB_NAMES[tabType],
    tabType,
    orderSn: row.orderSn || "",
    afterSalesId: row.afterSalesId || null,
    afterSalesStatus: row.afterSalesStatus ?? null,
    afterSalesType: row.afterSalesType ?? null,
    refundAmountYuan: cents(row.refundAmount),
    receiveAmountYuan: cents(row.receiveAmount),
    canCargoAppealAmountYuan: cents(row.canCargoAppealAmount),
    canFreightAppealAmountYuan: cents(row.canFreightAppealAmount),
    compensateAmountYuan: cents(row.compensateAmount),
    refundTime: msToIso(row.refundTime),
    expireRemainTimeMs: row.expireRemainTime ?? null,
    expireRemainHours: row.expireRemainTime ? Number((row.expireRemainTime / 3600000).toFixed(1)) : null,
    shippingStatus: row.sellerAfterSalesShippingStatus ?? null,
    shippingStatusDesc: row.sellerAfterSalesShippingStatusDesc || "",
    reasonCode: row.reasonCode ?? null,
    reasonDesc: row.reasonDesc || "",
    goodsName: row.goodsName || "",
    goodsSpec: row.goodsSpec || "",
    expressSignStatus: row.expressSignStatus ?? null,
    reverseLogisticOnWay: row.reverseLogisticOnWay ?? null,
    temporaryNoAppeal: Boolean(row.temporaryNoAppeal),
    lowPassRate: row.lowPassRate ?? null,
    forbiddenReasons: row.subAppealForbiddenReasonDescMap || null,
    raw: row
  };
}

async function fetchTab(page, tabType, pageSize, maxPages) {
  const rows = [];
  let total = null;
  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    const payload = {
      needCheckAppeal: true,
      pageIndex,
      pageSize,
      subAppealQueryType: tabType,
      searchWillExpire: false,
      filterNoAppealMarkAndLowPass: true
    };
    const response = await page.evaluate(async ({ apiPath, body }) => {
      const res = await fetch(apiPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return res.json();
    }, { apiPath: API_PATH, body: payload });
    if (!response || response.success !== true) {
      throw new Error(`接口返回异常：${JSON.stringify(response).slice(0, 200)}`);
    }
    const result = response.result || {};
    total = result.total ?? 0;
    const list = result.queryCanAppealInfoDetails || [];
    rows.push(...list);
    if (rows.length >= total || list.length === 0) break;
  }
  return { total, rows };
}

// 申诉记录（提交后看审核状态）
function normalizeRecord(row) {
  const msToIso = (value) => (value ? new Date(Number(value)).toISOString() : null);
  return {
    orderSn: row.orderSn || "",
    appealId: row.appealId ?? null,
    appealSubId: row.appealSubId ?? null,
    appealTypeDesc: row.appealTypeDesc || "",
    appealSubTypeDesc: row.appealSubTypeDesc || "",
    applyTime: msToIso(row.applyTime),
    statusDesc: row.appealSubStatusDescWithRemit || row.appealSubStatusDesc || row.appealSubStatus || "",
    amountYuan: row.amount == null ? null : Number((row.amount / 100).toFixed(2)),
    remitAmountYuan: row.remitAmount == null ? null : Number((row.remitAmount / 100).toFixed(2)),
    goodsSpec: row.goodsSpec || "",
    raw: row
  };
}

async function fetchRecords(page, days, pageSize, maxPages) {
  const rows = [];
  let total = null;
  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    const payload = {
      flowStatusList: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      pageIndex,
      pageSize,
      appealSubStatus: [],
      onlyShowReconsiderAppeal: false,
      onlyShowNeedAppealPicture: false,
      startApplyTime: Date.now() - days * 86400000,
      endApplyTime: Date.now()
    };
    const response = await page.evaluate(async ({ apiPath, body }) => {
      const res = await fetch(apiPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return res.json();
    }, { apiPath: RECORDS_API_PATH, body: payload });
    if (!response || response.success !== true) {
      throw new Error(`申诉记录接口返回异常：${JSON.stringify(response).slice(0, 200)}`);
    }
    const result = response.result || {};
    total = result.total ?? 0;
    const list = result.queryAppealInfoFromEsDetailList || [];
    rows.push(...list);
    if (rows.length >= total || list.length === 0) break;
  }
  return { total, rows };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "pdd", store: args.store });
  const tabs = args.tabs.split(",").map((s) => Number(s.trim())).filter((n) => TAB_NAMES[n]);
  if (!tabs.length) throw new Error("--tabs 里没有有效类型（可用 1,5,2,7）");
  log("可申诉清单", "开始", `${args.store}（${store.name}，端口 ${store.port}）`, `类型 ${tabs.map((t) => TAB_NAMES[t]).join("、")}`);

  let session = null;
  if (args.attach) {
    session = await attachStoreBrowser({ profileDir: store.profileDir, port: store.port });
    if (!session) throw new Error(`端口 ${store.port} 上没有本店铺窗口，无法附着`);
  } else {
    session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: HOME_URL, debugPort: store.port });
  }
  const page = await session.context.newPage();
  const out = { store: args.store, storeName: store.name, mode: args.records ? "records" : "can-appeal", collectedAt: new Date().toISOString(), tabs: [], items: [] };
  try {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    if (page.url().includes("/login/")) {
      throw new Error("登录态失效（跳到登录页）——先跑 src/tools/pdd-login.js --store " + args.store);
    }
    if (args.records) {
      const { total, rows } = await fetchRecords(page, args.days, args.pageSize, args.maxPages);
      const items = rows.map(normalizeRecord);
      out.records = { total, days: args.days, items };
      log("申诉记录", "采集完成", `近 ${args.days} 天`, `${items.length}/${total} 条`);
      console.log(`  申诉记录（近 ${args.days} 天）：${items.length}/${total} 条`);
    } else {
      for (const tabType of tabs) {
        const { total, rows } = await fetchTab(page, tabType, args.pageSize, args.maxPages);
        const items = rows.map((row) => normalize(row, tabType));
        out.tabs.push({ tabType, tab: TAB_NAMES[tabType], total, collected: items.length });
        out.items.push(...items);
        log("可申诉清单", "采集完成", `${TAB_NAMES[tabType]}（type=${tabType}）`, `${items.length}/${total} 条`);
        console.log(`  ${TAB_NAMES[tabType]}：${items.length}/${total} 条`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  // 去重统计（同一订单可能在多个 tab 出现；申诉记录里同一 appealId 会有多行子申诉）
  const collectItems = args.records ? (out.records?.items || []) : out.items;
  const uniqueOrders = new Set(collectItems.map((item) => item.orderSn).filter(Boolean));
  out.uniqueOrderCount = uniqueOrders.size;
  const outFile = projectPath(args.out || path.join("runtime", "pdd", args.records ? `申诉记录-${args.store}-${stamp()}.json` : `申诉清单-${args.store}-${stamp()}.json`));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n  合计 ${collectItems.length} 条 / 唯一订单 ${out.uniqueOrderCount} 个`);
  console.log(`  落盘：${path.relative(projectPath(), outFile)}\n`);
  // 附着/拉起的是 keepOpen 浏览器（不关窗口），但 Node 进程要退出（否则 CDP 连接把 CLI 挂住）
  process.exit(0);
}

main().catch((error) => {
  log("可申诉清单", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
