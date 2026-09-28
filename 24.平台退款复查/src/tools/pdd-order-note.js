// 拼多多：读订单在「售后工作台」的后台备注原文（只读）。
//   node src/tools/pdd-order-note.js --store pdd02 --orders 260926-278396956242177 260827-138632240734011
//
// ⚠ 经验（2026-09-27 用户指出）：**不要用 ERP 的卖家备注（sellerMemo）判断处理进度**——ERP 备注不更新，
//   真实处理进度看平台后台备注。拼多多后台备注在售后工作台列表接口 `/mercury/mms/afterSales/queryList`
//   的 `mallRemark` 字段（形如「88 已通知拦截 [德达旗舰店:客服庚 09/26 21:15]」）。
//   备注是自由文本，只抓原文交模型语义读，禁止关键词程序判。
//
// 用法要点：先开售后工作台页面，再在页面内同源 fetch 搜索接口（每单一次 searchText 查询）。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { projectPath, resolveStore } = require("../config/stores");
const { log } = require("../engine/log");

function parseArgs(argv) {
  const args = { store: null, orders: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--store") { args.store = argv[i + 1]; i += 1; continue; }
    if (token === "--orders") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) { args.orders.push(argv[i + 1]); i += 1; }
      continue;
    }
    if (token === "--out") { args.out = argv[i + 1]; i += 1; continue; }
    if (token === "--orders-file") {
      const file = projectPath(argv[i + 1]);
      args.orders.push(...fs.readFileSync(file, "utf8").split(/\s+/).filter(Boolean));
      i += 1;
      continue;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orders = [...new Set(args.orders)];
  if (!args.store || !orders.length) throw new Error("用法：--store pdd02 --orders <订单号...>");
  const store = resolveStore({ platform: "pdd", store: args.store });
  const port = store.port || 9445;

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = await context.newPage();
  try {
    await page.goto("https://mms.pinduoduo.com/aftersales/aftersale_list", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    log("拼多多备注", "页面就绪", store.name);

    const rows = [];
    for (const orderSn of orders) {
      const result = await page.evaluate(async (sn) => {
        const res = await fetch("/mercury/mms/afterSales/queryList", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageSize: 10, searchText: sn, pageNumber: 1, orderByCreatedAtDesc: true }),
          credentials: "include",
        });
        const json = await res.json().catch(() => null);
        return { status: res.status, json };
      }, orderSn);
      const list = result.json?.result?.list || [];
      const hit = list.find((row) => row.orderSn === orderSn) || list[0] || null;
      rows.push({
        orderSn,
        found: Boolean(hit),
        httpStatus: result.status,
        apiError: result.json?.success === false ? result.json?.errorMsg || "接口失败" : null,
        mallRemark: hit ? hit.mallRemark || "" : "",
        remarkStatus: hit ? hit.remarkStatus ?? null : null,
        mallRemarkTagName: hit ? hit.mallRemarkTagName ?? null : null,
        afterSalesStatus: hit ? hit.afterSalesStatus ?? null : null,
        afterSalesId: hit ? hit.afterSalesId ?? null : null,
        sellerAfterSalesShippingStatusDesc: hit ? hit.sellerAfterSalesShippingStatusDesc ?? null : null,
      });
      log("拼多多备注", orderSn, hit ? `后台备注：${(hit.mallRemark || "（空）").replace(/\s+/g, " ")}` : "售后工作台查无此单");
    }

    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const outFile = args.out ? projectPath(args.out) : projectPath("runtime", "pdd", `订单备注-${args.store}-${stamp}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify({ store: args.store, storeName: store.name, createdAt: new Date().toISOString(), rows }, null, 2), "utf8");
    log("拼多多备注", "完成", `${rows.length} 单`, path.relative(projectPath(), outFile));
    console.log(`\n  ✓ ${rows.length} 单 → ${path.relative(projectPath(), outFile)}\n`);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  log("拼多多备注", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exitCode = 1;
});
