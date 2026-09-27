#!/usr/bin/env node
// 采集京东「交易纠纷 → 可申诉」清单（只读）。
//
// 入口（2026-09-27 实测）：https://shop.jd.com/jdm/trade/after-sale/trade-dispute/list
//   tab：全部 / 京东介入 / 待回复 / 待处理 / 和解中 / 待执行 / **可申诉** / 已申诉
// 数据来源：页面自己的网关接口（页内同源调用，不点「申诉」按钮）：
//   POST https://sff.jd.com/api?v=1.0&appId=BHPQ4MHJBUOQZKTFTRNS&api=dsm.seller.cs.ArbitListService.pageSearch
//   body: {"request":{"data":{"pageIndex":1,"pageSize":50,"clientType":2,
//                            "arbitTabEnum":"CAN_APPEAL","arbitAppealTabEnum":"CAN_APPEAL"}},"accessContext":{"source":"web"}}
//   arbitTabEnum：ALL / JD_TAKE_PART / WAIT_REPLY / WAIT_PROCESS / PEACE / WAIT_EXECUTE / CAN_APPEAL / APPEAL
//
// 关键字段（判「货物安全」用）：
//   arbitId            纠纷单编号（如 85195181）
//   orderId            京东订单号（如 320424803611）
//   arbitTypeDesc      纠纷类型（已收货售后 / 退货 / 未收到货-退款问题 …）
//   arbitResultDesc    判责结果（商家责任 / 客户责任 / 商家已和解 …）
//   arbitStateDesc     纠纷单状态（纠纷单关闭 …）
//   arbitNodeStateDesc 节点说明（如「超时未申诉」）
//   canAppeal          是否可申诉（**可申诉 tab = true**）
//   arbitAppealState / arbitAppealStateDesc  申诉状态（待领取/待处理/申诉成功/申诉失败…）
//   overTimeDate / arbitOverTimeSolutionDesc 申诉时限提示（毫秒 + 文案）
//   skuList / orderId / venderId / pin        商品 / 店铺
//
// 用法：
//   node src/tools/jd-appeal-list.js --store jd1
//   node src/tools/jd-appeal-list.js --store jd1 --tabs CAN_APPEAL,APPEAL
//   node src/tools/jd-appeal-list.js --store jd1 --attach        # 附着已开窗口（9450+）
//
// 只读：只打开列表页 + POST 查询接口，不点任何「申诉/提交」按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { attachStoreBrowser, openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

const LIST_URL = "https://shop.jd.com/jdm/trade/after-sale/trade-dispute/list";
// 页面自己调的网关接口（带 h5st 签名，只能抓不能重放）：
//   POST https://sff.jd.com/api?v=1.0&appId=BHPQ4MHJBUOQZKTFTRNS&api=dsm.seller.cs.ArbitListService.pageSearch
const TAB_NAMES = { ALL: "全部", JD_TAKE_PART: "京东介入", WAIT_REPLY: "待回复", WAIT_PROCESS: "待处理", PEACE: "和解中", WAIT_EXECUTE: "待执行", CAN_APPEAL: "可申诉", APPEAL: "已申诉" };

function parseArgs(argv) {
  const args = { store: "jd1", tabs: "CAN_APPEAL", pageSize: 50, maxPages: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "attach") { args.attach = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "store") args.store = value;
    else if (key === "tabs") args.tabs = value;
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

function normalize(row, tab) {
  const msToIso = (value) => (value ? new Date(Number(value)).toISOString() : null);
  return {
    tab: TAB_NAMES[tab] || tab,
    tabKey: tab,
    arbitId: row.arbitId ?? null,
    orderId: row.orderId ? String(row.orderId) : "",
    arbitType: row.arbitType ?? null,
    arbitTypeDesc: row.arbitTypeDesc || "",
    arbitResult: row.arbitResult ?? null,
    arbitResultDesc: row.arbitResultDesc || "",
    arbitState: row.arbitState ?? null,
    arbitStateDesc: row.arbitStateDesc || "",
    arbitNodeStateDesc: row.arbitNodeStateDesc || "",
    canAppeal: Boolean(row.canAppeal),
    arbitAppealState: row.arbitAppealState ?? null,
    arbitAppealStateDesc: row.arbitAppealStateDesc || "",
    overTimeDate: row.overTimeDate ?? null,
    overTimeDateIso: msToIso(row.overTimeDate),
    arbitOverTimeSolutionDesc: row.arbitOverTimeSolutionDesc || "",
    applyTime: msToIso(row.arbitApplyTime),
    updateTime: msToIso(row.arbitUpdateTime || row.modified),
    venderId: row.venderId ?? null,
    customerPin: row.customerPin || "",
    goods: (row.skuList || []).map((sku) => ({ name: sku.name || "", color: sku.color || "", count: sku.count ?? null, price: sku.price ?? null })),
    raw: row
  };
}

async function clickTab(page, tabName) {
  const clicked = await page.evaluate((name) => {
    const nodes = Array.from(document.querySelectorAll("div,span,a,li"));
    const hit = nodes.find((el) => (el.innerText || "").trim().startsWith(name) && el.offsetParent !== null && (el.innerText || "").trim().length <= name.length + 8);
    if (!hit) return false;
    hit.click();
    return true;
  }, tabName);
  if (!clicked) throw new Error(`没找到「${tabName}」tab 元素`);
}

async function clickNextPage(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("div,span,a,button,li"));
    const hit = nodes.find((el) => (el.innerText || "").trim() === "下一页" && el.offsetParent !== null && !/disabled/i.test(String(el.className)));
    if (!hit) return false;
    hit.click();
    return true;
  });
}

// 京东网关带 h5st 签名（页内 fetch 会被拒 code 312），所以只能驱动页面点 tab、抓页面自己的响应。
async function fetchTabByClick(page, tab, maxPages) {
  const rows = [];
  let total = null;
  for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
    const waiter = page.waitForResponse((res) => res.url().includes("ArbitListService.pageSearch"), { timeout: pageIndex === 1 ? 20000 : 40000 }).catch(() => null);
    if (pageIndex === 1) await clickTab(page, TAB_NAMES[tab]);
    else if (!(await clickNextPage(page))) break;
    const response = await waiter;
    if (!response) {
      // 点了 tab 但页面没发请求（例如该 tab 本来就是当前 tab）——不算失败，继续下一个 tab
      if (pageIndex === 1) return { total: null, rows, note: "点击后无新请求（可能已是当前 tab）" };
      break;
    }
    const json = await response.json();
    if (!json || json.code !== 200) throw new Error(`接口返回异常：${JSON.stringify(json).slice(0, 200)}`);
    const data = json.data || {};
    total = data.total ?? 0;
    const list = data.results || [];
    rows.push(...list);
    if (rows.length >= total || list.length === 0) break;
  }
  return { total, rows };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "jd", store: args.store });
  const tabs = args.tabs.split(",").map((s) => s.trim().toUpperCase()).filter((t) => TAB_NAMES[t]);
  if (!tabs.length) throw new Error(`--tabs 里没有有效类型（可用 ${Object.keys(TAB_NAMES).join(",")}）`);
  log("京东可申诉清单", "开始", `${args.store}（${store.name}，端口 ${store.port}）`, `tab ${tabs.map((t) => TAB_NAMES[t]).join("、")}`);

  let session = null;
  if (args.attach) {
    session = await attachStoreBrowser({ profileDir: store.profileDir, port: store.port });
    if (!session) throw new Error(`端口 ${store.port} 上没有本店铺窗口，无法附着`);
  } else {
    session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: LIST_URL, debugPort: store.port });
  }
  const page = await session.context.newPage();
  const out = { store: args.store, storeName: store.name, collectedAt: new Date().toISOString(), tabs: [], items: [] };
  try {
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(9000); // 等微应用渲染出页面自己的接口调用（拿到登录态）
    for (const tab of tabs) {
      const { total, rows, note } = await fetchTabByClick(page, tab, args.maxPages);
      out.tabs.push({ tab, tabKey: tab, name: TAB_NAMES[tab], total, fetched: rows.length, note });
      for (const row of rows) out.items.push(normalize(row, tab));
      log("京东可申诉清单", TAB_NAMES[tab], total === null ? "未取到" : `total=${total}`, note || `已取 ${rows.length} 条`);
      await page.waitForTimeout(1200);
    }
    const outFile = args.out ? projectPath(args.out) : projectPath("runtime", "jd", `申诉清单-${args.store}-${stamp()}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
    log("京东可申诉清单", "完成", `${out.items.length} 条`, path.relative(projectPath(), outFile));
    for (const tab of out.tabs) console.log(`    ${tab.name}：页面 total=${tab.total}，已取 ${tab.fetched} 条`);
    console.log(`\n  ✓ ${out.items.length} 条 → ${path.relative(projectPath(), outFile)}\n`);
  } finally {
    await page.close().catch(() => {});
    if (!args.attach) await session.browser.close().catch(() => {});
  }
}

main().catch((error) => {
  log("京东可申诉清单", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exitCode = 1;
});
