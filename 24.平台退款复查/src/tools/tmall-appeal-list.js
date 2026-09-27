#!/usr/bin/env node
// 采集天猫「退款申诉」待申诉订单清单（只读）。
//
// 页面：https://qn.taobao.com/home.htm/appeal/portal/appealable/D/1
//   类型 tab（2026-09-27 实测）：
//     D=纠纷、P=赔付、C=处罚、T=投诉；**直接改 URL 不会切换 tab**（微应用加载时默认 D），
//     必须点页面上「纠纷/赔付/处罚/投诉」文字元素，页面才会发 appealSource=对应字母的请求。
// 数据来源：页面微应用自己发的 mtop 接口 `mtop.taobao.appealcenter.list.get`（列表）
//   和 `mtop.taobao.appealcenter.list.count.get`（计数）。本工具**不逆向签名**，
//   只让页面自己翻页、从网络响应里原样取数（最稳）。
// 关键字段（实测 2026-09-27）：
//   objectId        退款编号
//   relatedObjectId 订单编号  ← ERP 查单/金山核对就用它
//   handleType      退货退款 / 仅退款 / …
//   violationType   纠纷申诉 / …
//   appealTime      处置时间（退款结束时间）
//   leftTime        可申诉剩余毫秒
//   disputeId       纠纷 ID
//
// 用法：
//   node src/tools/tmall-appeal-list.js --store tmall1
//   node src/tools/tmall-appeal-list.js --store tmall1 --tabs D,P --out runtime/tmall/申诉清单-tmall1.json
//   node src/tools/tmall-appeal-list.js --store tmall1 --attach     # 复用已开窗口
//
// 只读：只点「类型 tab」和「下一页」翻页，不点任何「我要申诉」等业务按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { attachStoreBrowser, openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

const TAB_NAMES = { D: "纠纷", P: "赔付", C: "处罚", T: "投诉" };

function parseArgs(argv) {
  const args = { store: "tmall1", tabs: "D,P,C,T", maxPages: 20 };
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
    else if (key === "max-pages") args.maxPages = Number(value);
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

// 点击页面上文字完全等于 name 的元素（跨 frame）
async function clickByText(page, name) {
  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate((text) => {
        const nodes = Array.from(document.querySelectorAll("div,span,a,li,button,label"));
        const hit = nodes.find((el) => (el.innerText || "").trim() === text && el.children.length === 0 && el.offsetParent !== null);
        if (!hit) return false;
        const target = hit.closest("a,li,button,[role=tab],div") || hit;
        target.click();
        return true;
      }, name);
      if (clicked) return true;
    } catch (error) { /* 跨域 frame 忽略 */ }
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "tmall", store: args.store });
  const tabs = args.tabs.split(",").map((s) => s.trim()).filter((s) => TAB_NAMES[s]);
  if (!tabs.length) throw new Error("--tabs 里没有有效类型（可用 D,P,C,T）");
  log("申诉清单", "开始", `${args.store}（${store.name}，端口 ${store.port}）`, `类型 ${tabs.join(",")}`);

  let session = null;
  if (args.attach) {
    session = await attachStoreBrowser({ profileDir: store.profileDir, port: store.port });
    if (!session) throw new Error(`端口 ${store.port} 上没有本店铺窗口，无法附着`);
  } else {
    session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: "https://qn.taobao.com/home.htm/appeal/portal/appealable/D/1", debugPort: store.port });
  }
  const context = session.context;
  const page = await context.newPage();

  // 网络响应池：记录 list.get / list.count.get 的结果 + 请求里的 appealSource
  const responses = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!/appealcenter\.(list\.get|list\.count\.get)/.test(url)) return;
    try {
      const payload = await response.json();
      const resultData = (payload && payload.data && payload.data.resultData) || null;
      if (!resultData) return;
      let appealSource = "";
      try {
        const reqData = JSON.parse(decodeURIComponent(response.request().postData() || "").replace(/^data=/, ""));
        appealSource = String(reqData.appealSource || "");
      } catch (error) { appealSource = ""; }
      responses.push({ kind: /count\.get/.test(url) ? "count" : "list", appealSource, resultData, at: Date.now() });
    } catch (error) { /* 忽略非 JSON */ }
  });

  const waitFor = (predicate, timeoutMs) => new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const hit = responses.find(predicate);
      if (hit) { clearInterval(timer); resolve(hit); return; }
      if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve(null); }
    }, 300);
  });

  const result = { store: args.store, storeName: store.name, collectedAt: new Date().toISOString(), tabs: [], items: [] };
  try {
    await page.goto("https://qn.taobao.com/home.htm/appeal/portal/appealable/D/1", { waitUntil: "domcontentloaded", timeout: 45000 })
      .catch((error) => log("申诉清单", "导航失败", error.message));
    await sleep(3000);
    if (page.url().includes("loginmyseller")) {
      throw new Error("登录态失效（跳到 loginmyseller）——先跑 src/tools/tmall-login.js --store <店>");
    }

    for (const letter of tabs) {
      const tabName = TAB_NAMES[letter];
      const beforeClick = responses.length;
      const clicked = await clickByText(page, tabName);
      if (!clicked) log("申诉清单", "点不到类型", `${tabName}(${letter})`);
      const first = await waitFor((r) => r.kind === "list" && r.appealSource === letter && Array.isArray(r.resultData.listData), 15000)
        || await waitFor((r) => r.kind === "list" && Array.isArray(r.resultData.listData) && responses.indexOf(r) >= beforeClick, 5000);
      const items = [];
      let counts = null;
      if (first) {
        const append = (resultData) => {
          if (!resultData || !Array.isArray(resultData.listData)) return;
          for (const item of resultData.listData) {
            items.push({
              tab: letter,
              violationType: item.violationType || "",
              handleType: item.handleType || "",
              refundId: item.objectId || "",
              orderId: item.relatedObjectId || "",
              appealTime: item.appealTime || item.violationStartTime || "",
              leftTimeMs: item.leftTime || 0,
              leftHours: item.leftTime ? Number((item.leftTime / 3600000).toFixed(1)) : 0,
              disputeId: item.disputeId || "",
              capitalReason: item.capitalReason || "",
              supportAppeal: Boolean(item.supportAppeal),
              raw: item
            });
          }
        };
        append(first.resultData);
        const seenRefundIds = new Set(items.map((item) => `${item.refundId}|${item.orderId}`));
        let totalPageNo = Number(first.resultData.totalPageNo || 1);
        let pageNo = 1;
        // 坑（2026-09-27 实测）：翻页后接口的 resultData.pageNo 仍回 1，不能靠 pageNo 判断翻页成功；
        // 用「点击后是否出现新的 list 响应 + 有没有新条目」来判断。
        while (pageNo < totalPageNo && pageNo < args.maxPages) {
          await sleep(1200);
          const before = responses.length;
          const nextClicked = await clickByText(page, "下一页");
          if (!nextClicked) { log("申诉清单", "翻页失败", `${tabName} 第 ${pageNo}/${totalPageNo} 页`); break; }
          const next = await waitFor((r) => r.kind === "list" && r.appealSource === letter && responses.indexOf(r) >= before, 20000);
          if (!next) { log("申诉清单", "翻页超时", `${tabName} 第 ${pageNo + 1} 页`); break; }
          const beforeCount = items.length;
          append(next.resultData);
          const fresh = items.slice(beforeCount).filter((item) => !seenRefundIds.has(`${item.refundId}|${item.orderId}`));
          for (const item of items.slice(beforeCount)) seenRefundIds.add(`${item.refundId}|${item.orderId}`);
          if (!fresh.length) { log("申诉清单", "翻页无新数据", `${tabName} 第 ${pageNo + 1} 页`); break; }
          pageNo += 1;
          totalPageNo = Number(next.resultData.totalPageNo || totalPageNo);
        }
      }
      const countHit = responses.filter((r) => r.kind === "count").slice(-1)[0];
      counts = countHit ? countHit.resultData : null;
      result.tabs.push({ tab: tabName, letter, counts, itemCount: items.length });
      result.items.push(...items);
      log("申诉清单", `类型 ${tabName}(${letter})`, `待申诉 ${items.length} 条`, counts ? JSON.stringify(counts) : "");
      await sleep(800);
    }
  } finally {
    await page.close().catch(() => {});
  }

  const outFile = args.out
    ? projectPath(args.out)
    : projectPath("runtime", "tmall", `申诉清单-${args.store}-${stamp()}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log(`\n  ${store.name}（${args.store}）待申诉清单：`);
  for (const item of result.items) {
    console.log(`    [${item.tab}] ${item.violationType} | ${item.handleType} | 退款编号 ${item.refundId} | 订单编号 ${item.orderId} | ${item.appealTime} | 剩 ${item.leftHours}h`);
  }
  console.log(`\n  共 ${result.items.length} 条；落盘：${path.relative(projectPath(), outFile)}\n`);
  process.exit(0);
}

main().catch((error) => {
  log("申诉清单", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
