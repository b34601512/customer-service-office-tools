#!/usr/bin/env node
// 京东「仅退款」漏退回检查 · 第一步：取各店「仅退款（未收货退款/已收货退款）+ 退款成功 + 已出库」订单（只读）。
//
// 为什么（用户 2026-09-27 口径 + 他以前的手工流程）：
//   退货退款每一笔都人工审核过了，**只有「仅退款」才需要重点查货有没有退回**；
//   未出库不用看（没货可退）→ 只留「已出库」；再拿去匹配 怀化退款表 + 京东仓退货表，
//   两边都匹配不到 = 0 = 漏退回，要重点看。
//
// 入口：https://shop.jd.com/jdm/trade/after-sale/independent-after-sale/list（交易 → 售后管理 → 自主售后）
//   接口：POST https://sff.jd.com/api?v=1.0&appId=DEB3TVXQG94DTQODWFFH&api=dsm.seller.afs.bff.serviceOrderQueryDsmService.page
//   **带签名（页内 fetch 被拒 code 312）→ 只能驱动页面**。
// 实测（2026-09-27）：
//   · 筛选控件必须用**真实鼠标点击**才展开（JS el.click() 打不开下拉）；
//   · 切「全部」tab 后要重新点「展开」才会出现「发货物流」等筛选项；
//   · 条件：客户期望=[150 未收货退款, 11 已收货退款]、退款状态=[20 退款成功]、发货物流=[20 已出库]；
//   · 每页条数可切 100 条/页，减少翻页。
//
// 用法：
//   node src/tools/jd-refund-list.js --store jd1
//   node src/tools/jd-refund-list.js --store jd1 --attach --page-size 100
//
// 只读：只点 tab / 展开 / 筛选项 / 查询 / 翻页，不点任何「同意/退款/提交」按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { attachStoreBrowser, openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

const LIST_URL = "https://shop.jd.com/jdm/trade/after-sale/independent-after-sale/list";
const API_MARK = "serviceOrderQueryDsmService.page";
const EXPECT_REFUND_ONLY = ["未收货退款", "已收货退款"]; // = 仅退款
const REFUND_SUCCESS = "退款成功";
const DELIVERY_SHIPPED = "已出库";

function parseArgs(argv) {
  const args = { store: "jd1", pageSize: 100, maxPages: 40 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "attach") { args.attach = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "store") args.store = value;
    else if (key === "out") args.out = value;
    else if (key === "page-size") args.pageSize = Number(value);
    else if (key === "max-pages") args.maxPages = Number(value);
  }
  return args;
}

function stamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function formItem(page, label) {
  return page.locator(".el-form-item, [class*=form-item]").filter({ hasText: new RegExp(`^${label}$`) }).first();
}

// 真实鼠标点开下拉 → 逐个点选 → Esc 收起
async function setSelect(page, label, values) {
  const item = formItem(page, label);
  const input = item.locator("input").first();
  await input.scrollIntoViewIfNeeded();
  await input.click({ timeout: 15000 });
  await page.waitForTimeout(900);
  for (const value of values) {
    const option = page.locator(".jd-select-dropdown__item, .el-select-dropdown__item").filter({ hasText: new RegExp(`^${value}$`) }).first();
    if (!(await option.isVisible().catch(() => false))) { log("京东仅退款", "筛选项不可见", `${label} → ${value}`); continue; }
    await option.click({ timeout: 10000 });
    await page.waitForTimeout(500);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
}

async function setPageSize(page, size) {
  try {
    const input = page.locator(".jd-pagination input").first();
    if (!(await input.isVisible().catch(() => false))) return false;
    await input.click({ timeout: 8000 });
    await page.waitForTimeout(800);
    const option = page.locator(".jd-select-dropdown__item, .el-select-dropdown__item").filter({ hasText: new RegExp(`^${size}条/页$`) }).first();
    if (!(await option.isVisible().catch(() => false))) { await page.keyboard.press("Escape"); return false; }
    await option.click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    return true;
  } catch { return false; }
}

async function clickNext(page) {
  return page.evaluate(() => {
    const btn = document.querySelector(".jd-pagination .btn-next");
    if (!btn || /disabled/.test(String(btn.className))) return false;
    btn.click();
    return true;
  });
}

function pickRow(row) {
  const flat = {};
  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj || {})) {
      if (value && typeof value === "object" && !Array.isArray(value)) walk(value, `${prefix}${key}.`);
      else if (!Array.isArray(value)) flat[`${prefix}${key}`] = value;
    }
  };
  walk(row, "");
  const pick = (...keys) => {
    for (const key of keys) {
      const hit = Object.keys(flat).find((k) => k === key || k.endsWith(`.${key}`));
      if (hit && flat[hit] !== undefined && flat[hit] !== null && flat[hit] !== "") return flat[hit];
    }
    return null;
  };
  const msToIso = (value) => (value ? new Date(Number(value)).toISOString() : null);
  return {
    orderId: String(pick("orderId") || ""),
    serviceOrderId: String(pick("afsServiceId") || ""),
    reverseId: String(pick("reverseId") || ""),
    customerExpect: pick("customerExpect"),
    afsStatusTitle: pick("afsStatusTitle") || "",
    applyReason: pick("afsReasons") || "",
    applyTime: msToIso(pick("afsApplyTime", "applyTime")),
    actualPayAmount: pick("actualPayTotalAmount", "actualPayAmount"),
    customerPin: pick("customerPin", "afsApplyPin") || "",
    wareName: pick("wareName") || "",
    wareNum: pick("wareNum"),
    raw: row
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "jd", store: args.store });
  log("京东仅退款", "开始", `${args.store}（${store.name}，端口 ${store.port}）`, `仅退款+${REFUND_SUCCESS}+${DELIVERY_SHIPPED}`);

  let session = null;
  if (args.attach) {
    session = await attachStoreBrowser({ profileDir: store.profileDir, port: store.port });
    if (!session) throw new Error(`端口 ${store.port} 上没有本店铺窗口，无法附着`);
  } else {
    session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: LIST_URL, debugPort: store.port });
  }

  const page = await session.context.newPage();
  const responses = [];
  page.on("response", async (res) => {
    if (!res.url().includes(API_MARK)) return;
    try {
      const json = await res.json();
      responses.push({ total: Number(json?.data?.totalNum || 0), rows: json?.data?.content || [] });
    } catch { /* 忽略 */ }
  });

  const out = { store: args.store, storeName: store.name, collectedAt: new Date().toISOString(), source: LIST_URL, condition: `客户期望=${EXPECT_REFUND_ONLY.join("/")} + 退款状态=${REFUND_SUCCESS} + 发货物流=${DELIVERY_SHIPPED}`, total: 0, items: [] };
  try {
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(13000);

    // 1) 切「全部」tab（默认在「待审核」，会把结果筛没）
    const tabClicked = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll(".jd-tabs__item")).find((x) => (x.innerText || "").trim() === "全部" && x.offsetParent !== null);
      if (!el) return false;
      el.click();
      return true;
    });
    if (!tabClicked) throw new Error("没找到「全部」tab");
    await page.waitForTimeout(6000);

    // 2) 展开筛选（切 tab 后会收起，必须重新展开）
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("div,span,a,button")).find((x) => (x.innerText || "").trim() === "展开" && x.offsetParent !== null);
      el?.click();
    });
    await page.waitForTimeout(2000);

    // 3) 三个筛选条件
    await setSelect(page, "客户期望", EXPECT_REFUND_ONLY);
    await setSelect(page, "退款状态", [REFUND_SUCCESS]);
    await setSelect(page, "发货物流", [DELIVERY_SHIPPED]);

    // 4) 查询
    responses.length = 0;
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("button,div,span")).find((x) => (x.innerText || "").trim() === "查询" && x.offsetParent !== null);
      el?.click();
    });
    await page.waitForTimeout(9000);
    await setPageSize(page, args.pageSize);

    // 5) 翻页收集
    const seen = new Set();
    const all = [];
    for (let round = 0; round < args.maxPages; round += 1) {
      const batch = responses.splice(0, responses.length);
      for (const chunk of batch) {
        out.total = chunk.total || out.total;
        for (const row of chunk.rows) {
          const item = pickRow(row);
          const key = item.serviceOrderId || item.orderId;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          all.push(item);
        }
      }
      if (!batch.length) break;
      if (all.length >= (out.total || 0)) break;
      if (!(await clickNext(page))) break;
      await page.waitForTimeout(4000);
    }

    out.items = all;
    out.fetched = all.length;
    const outFile = args.out ? projectPath(args.out) : projectPath("runtime", "jd", `仅退款已出库清单-${args.store}-${stamp()}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
    log("京东仅退款", "完成", `页面 total=${out.total}，抓到 ${all.length} 单`, path.relative(projectPath(), outFile));
    console.log(`\n  页面 total=${out.total}，抓到 ${all.length} 单（条件：${out.condition}）`);
    console.log(`  ✓ ${path.relative(projectPath(), outFile)}\n`);
  } finally {
    await page.close().catch(() => {});
    if (!args.attach) await session.browser.close().catch(() => {});
  }
}

main().catch((error) => {
  log("京东仅退款", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exitCode = 1;
});
