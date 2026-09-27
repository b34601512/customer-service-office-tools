#!/usr/bin/env node
// 25号 京东【上门换新取件】换货单采集（只读）。用户 2026-09-27 口径：
//   自主售后 → 全部 tab → 客户期望=换货 → 售后状态=完成 → 本地筛 pickWareTypeName == "上门换新取件" → 只留最近 30 天。
//
// 为什么是这几个条件（实测）：
//   · 换货+完成的单里，**每一行都带 `pickWareFacetDTO.pickWareTypeName`**，值为「上门换新取件」的就是京东仓上门换新的单；
//   · 「上门换新取件」不是商品名（搜商品名称搜不到）、也不是服务标签（标签里叫「可能上门换新」）→ 只能用这个字段本地筛。
//   · 页面默认查询窗口是最近 3 个月，30 天窗口在本地按申请时间（afsApplyTime）裁。
//
// 入口：https://shop.jd.com/jdm/trade/after-sale/independent-after-sale/list（交易 → 售后管理 → 自主售后）
//   接口：POST ...&api=dsm.seller.afs.bff.serviceOrderQueryDsmService.page（**带签名，页内 fetch 被拒 code 312 → 只能驱动页面**）
// 驱动页面的坑（照 24号 经验，别踩）：筛选控件必须**真实鼠标点**；默认 tab 是「待审核」要先切「全部」；切完 tab 筛选区收起要重新点「展开」。
//
// 用法：node src/tools/jd-exchange-list.js --store jd1 [--days 90] [--attach] [--page-size 100]
//   --days 默认 90（3 个月，=京东页面默认能查的范围，用户 2026-09-27 拍板「改成 3 个月」）
// 只读：只点 tab/展开/筛选/查询/翻页。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { attachStoreBrowser, openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

const LIST_URL = "https://shop.jd.com/jdm/trade/after-sale/independent-after-sale/list";
const API_MARK = "serviceOrderQueryDsmService.page";
const EXPECT_EXCHANGE = ["换货"];
const STATUS_DONE = "完成";
const PICK_TYPE_TARGET = "上门换新取件";

function parseArgs(argv) {
  const args = { store: "jd1", pageSize: 100, maxPages: 40, days: 90 };
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
    else if (key === "days") args.days = Number(value);
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
    if (!(await option.isVisible().catch(() => false))) { log("京东上门换新", "筛选项不可见", `${label} → ${value}`); continue; }
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
    // 判定用：这一行的取件类型——只有「上门换新取件」才是本任务要查的单
    pickWareTypeName: String(pick("pickWareTypeName") || ""),
    pickWareStateName: String(pick("pickWareStateName") || ""),
    approveResultName: String(pick("approveResultName") || ""),
    afsStatusTitle: String(pick("afsStatusTitle") || ""),
    serviceOrderStateName: String(pick("serviceOrderMainStateName") || ""),
    applyTime: msToIso(pick("afsApplyTime", "applyTime")),
    updateTime: msToIso(pick("updateDate", "approvedDate")),
    orderCompleteTime: msToIso(pick("orderCompleteTime")),
    vendorRemark: String(pick("vendorRemark") || ""),
    wareName: String(pick("wareName") || ""),
    actualPayAmount: pick("actualPayTotalAmount", "actualPayAmount"),
    raw: row
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "jd", store: args.store });
  log("京东上门换新", "开始", `${args.store}（${store.name}，端口 ${store.port}）`, `换货+${STATUS_DONE} → ${PICK_TYPE_TARGET}`);

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

  const out = {
    store: args.store, storeName: store.name, collectedAt: new Date().toISOString(), source: LIST_URL,
    condition: `客户期望=${EXPECT_EXCHANGE.join("/")} + 售后状态=${STATUS_DONE} → 本地筛 pickWareTypeName=「${PICK_TYPE_TARGET}」` + (args.days ? ` → 最近 ${args.days} 天` : ""),
    total: 0, pickTypeCount: 0, items: []
  };
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

    // 3) 两个筛选条件（用户口径：客户期望=换货 + 售后状态=完成）
    await setSelect(page, "客户期望", EXPECT_EXCHANGE);
    await setSelect(page, "售后状态", [STATUS_DONE]);

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

    // 本地筛：只留「上门换新取件」，并按申请时间裁窗口（默认 30 天）
    const pickOnes = all.filter((item) => item.pickWareTypeName === PICK_TYPE_TARGET);
    out.pickTypeCount = pickOnes.length;
    const cutoff = args.days ? Date.now() - args.days * 24 * 3600 * 1000 : 0;
    out.items = cutoff ? pickOnes.filter((item) => item.applyTime && new Date(item.applyTime).getTime() >= cutoff) : pickOnes;
    if (args.days) out.windowNote = `申请时间 >= ${new Date(cutoff).toISOString().slice(0, 10)}`;
    out.fetched = all.length;
    const outFile = args.out ? projectPath(args.out) : projectPath("runtime", "jd", `上门换新取件清单-${args.store}-${stamp()}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
    log("京东上门换新", "完成", `页面 total=${out.total}｜换货完成 ${all.length} 单｜上门换新取件 ${out.pickTypeCount} 单｜${args.days} 天内 ${out.items.length} 单`, path.relative(projectPath(), outFile));
    console.log(`\n  页面 total=${out.total}，抓到 ${all.length} 单（条件：${out.condition}）`);
    console.log(`  ✓ ${path.relative(projectPath(), outFile)}\n`);
  } finally {
    await page.close().catch(() => {});
    if (!args.attach) await session.browser.close().catch(() => {});
  }
}

main().catch((error) => {
  log("京东上门换新", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exitCode = 1;
});
