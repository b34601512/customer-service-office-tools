#!/usr/bin/env node
// 京东仓退货表：查「退货至京东库房管理」并导出明细（只读，用户 2026-09-27 口径）。
//
// 为什么要它（用户 2026-09-27）：**京东多一条安全判定**——货可能退到**京东仓**，
// 不能只看我们本厂（怀化）的《售后对接表》退货登记。京东仓有退回记录 = 货在京东仓 → 安全，不用管。
//
// 入口：https://wl.jdl.com/supplychain-inbound/return （京东物流商家工作台，**需单独登录**，
//       登录态存 runtime/state/browser-profiles/jdl/jdl1，端口 9460）
//   真正的应用在 iframe：https://scsw.jdl.com/returnWarehouse/queryReturnList
//   接口：POST https://api.jdl.com/rtwApi/queryRtwList（带签名，页内 fetch 会被拒 → 只能驱动页面）
// 导出：工具栏「导出」是个下拉 → **导出明细**（= 退货明细报表，商品级 CSV）→
//       轮询 exportTaskApi/queryExportTaskByPage → getExportDownloadUrl 拿签名链接 → 下载。
//
// 口径与坑（2026-09-27 实测）：
//   - 页面默认查询窗口就是**最近 3 个月**（建单时间），导出即取当前筛选结果；
//   - 展开筛选里确实有「上架时间」，但**实测填了它不会进查询参数**（queryRtwList 里只有 createTimeStr），
//     所以按页面默认的 3 个月窗口导（覆盖范围够；要更严的窗口得等平台支持）。
//   - 导出 CSV 是 **GB18030** 编码；关键列 = 「销售平台单号」（= 我们的订单号）「逆向运单号」「ECLP退货单号」。
//
// 用法：
//   node src/tools/jd-warehouse-returns.js                 # 附着 9460 已开窗口，导出到 runtime/jd/
//   node src/tools/jd-warehouse-returns.js --launch        # 没窗口就自己拉起（profile jdl/jdl1）
//   node src/tools/jd-warehouse-returns.js --out runtime/jd/xx.csv --json runtime/jd/xx.json
//
// 只读：只点「查询/导出明细」，不点任何新建/提交类按钮。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { projectPath } = require("../config/stores");
const { attachStoreBrowser, openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

const RETURN_URL = "https://wl.jdl.com/supplychain-inbound/return";
const JDL_PROFILE = "runtime/state/browser-profiles/jdl/jdl1";
const JDL_PORT = 9460;

function parseArgs(argv) {
  const args = { port: JDL_PORT, months: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "launch") { args.launch = true; continue; }
    const value = argv[index + 1];
    index += 1;
    if (key === "port") args.port = Number(value);
    else if (key === "months") args.months = Number(value);
    else if (key === "out") args.out = value;
    else if (key === "json") args.json = value;
  }
  return args;
}

function stamp() {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// 极简 CSV 解析（支持引号包裹、逗号、换行、双引号转义）
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch === "\r") { /* 跳过 */ }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

function decodeCsv(buffer) {
  // 实测京东导出是 GB18030；带 BOM 的 UTF-8 也兼容一下
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return new TextDecoder("utf-8").decode(buffer);
  try { return new TextDecoder("gb18030").decode(buffer); } catch { return new TextDecoder("utf-8").decode(buffer); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outCsv = args.out ? projectPath(args.out) : projectPath("runtime", "jd", `京东仓退货明细-${stamp()}.csv`);
  const outJson = args.json ? projectPath(args.json) : outCsv.replace(/\.csv$/i, ".json");

  let session = await attachStoreBrowser({ profileDir: projectPath(JDL_PROFILE), port: args.port });
  if (!session && args.launch) {
    session = await openStoreBrowser({ profileDir: projectPath(JDL_PROFILE), targetUrl: RETURN_URL, debugPort: args.port });
  }
  if (!session) throw new Error(`端口 ${args.port} 上没有京东物流窗口（先登录/拉起：--launch，登录态存 ${JDL_PROFILE}）`);

  const page = await session.context.newPage();
  let downloadUrl = null;
  page.on("response", async (res) => {
    if (!res.url().includes("getExportDownloadUrl")) return;
    try { const json = await res.json(); if (json && json.data) downloadUrl = json.data; } catch { /* 忽略 */ }
  });
  try {
    await page.goto(RETURN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(10000);
    const frame = page.frames().find((f) => f.url().includes("scsw.jdl.com"));
    if (!frame) throw new Error("没找到 scsw.jdl.com 的退货单 iframe（登录态可能失效）");
    log("京东仓退货", "页面就绪", "退货至京东库房管理");

    // 先查询一次，确保导出的是最新结果
    await frame.evaluate(() => {
      const el = Array.from(document.querySelectorAll("button,div,span")).find((x) => (x.innerText || "").trim() === "查询" && x.offsetParent !== null);
      el?.click();
    });
    await page.waitForTimeout(6000);

    // 导出：hover 出下拉 → 点「导出明细」
    await frame.locator("button.export-showTips").hover();
    await page.waitForTimeout(1200);
    const clicked = await frame.evaluate(() => {
      const el = Array.from(document.querySelectorAll(".dropdown-button-content .button-group-item")).find((x) => (x.innerText || "").trim() === "导出明细");
      if (!el) return false;
      el.click();
      return true;
    });
    if (!clicked) throw new Error("没找到「导出明细」菜单项");
    log("京东仓退货", "已点导出明细", "等导出任务生成");

    for (let i = 0; i < 30 && !downloadUrl; i += 1) await page.waitForTimeout(1000);
    if (!downloadUrl) throw new Error("等不到导出下载链接（getExportDownloadUrl 没回）");

    const fullUrl = downloadUrl.startsWith("//") ? `https:${downloadUrl}` : downloadUrl;
    const res = await fetch(fullUrl);
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(outCsv), { recursive: true });
    fs.writeFileSync(outCsv, buffer);

    const rows = parseCsv(decodeCsv(buffer));
    const header = rows[0].map((h) => String(h).trim().replace(/^"|"$/g, ""));
    const items = rows.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, String(cells[i] ?? "").trim().replace(/\t/g, "")])));
    const orders = [...new Set(items.map((item) => item["销售平台单号"]).filter(Boolean))];
    const json = {
      downloadedAt: new Date().toISOString(),
      source: RETURN_URL,
      csvFile: path.relative(projectPath(), outCsv),
      window: "页面默认最近 3 个月（建单时间）",
      rowCount: items.length,
      orderCount: orders.length,
      columns: header,
      items
    };
    fs.writeFileSync(outJson, JSON.stringify(json, null, 2), "utf8");
    log("京东仓退货", "完成", `${items.length} 行 / ${orders.length} 个销售平台单号`, path.relative(projectPath(), outCsv));
    console.log(`\n  ✓ ${items.length} 行 → ${path.relative(projectPath(), outCsv)}\n  ✓ 结构化 → ${path.relative(projectPath(), outJson)}\n`);
  } finally {
    await page.close().catch(() => {});
    await session.browser.close().catch(() => {});
  }
}

main().catch((error) => {
  log("京东仓退货", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exitCode = 1;
});
