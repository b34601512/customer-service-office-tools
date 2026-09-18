#!/usr/bin/env node
// 读天猫售后后台的「售后单统计」概览（一次拿到关键数字，不用一个个开详情）。
//
// 为什么这样能判漏：天猫规则是「退件签收后剩余处理时长缩短为 48 小时」，
//   所以「24小时内待处理 = 0」⟺ 没有"签收已超 24h 还没处理"的单（与判漏口径一致）；
//   包还没到、或还在时限内的单本来就不算漏。
//
// 用法：
//   node src/tools/tmall-refund-overview.js                        # 只读统计数字
//   node src/tools/tmall-refund-overview.js --probe-pending        # 额外点一次「24小时内即将超时」筛选，把超时单抓下来
//   node src/tools/tmall-refund-overview.js --store tmall2         # 换店铺
//
// 只读：只读页面文本；--probe-pending 只会点「24小时内即将超时」这个筛选按钮（纯筛选，不改后台任何数据）。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const LIST_URL = "https://qn.taobao.com/home.htm/trade-platform/refund-list";
const STAT_LABELS = [
  "24小时内待处理", "待处理售后", "退款待处理", "待收货", "待举证",
  "小二已介入", "商家已拒绝", "超时同意退款", "买家催促退款", "待买家处理"
];

function parseArgs(argv) {
  const args = { store: "tmall1" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "store") { args.store = argv[index + 1]; index += 1; continue; }
    if (key === "out") { args.out = argv[index + 1]; index += 1; continue; }
    if (key === "probe-pending") args.probePending = true;
  }
  return args;
}

function pickNumber(text, label) {
  // innerText 里标签与数字是换行分隔（如 "24小时内待处理\n0"），所以按标签位置往后找第一个数字最稳
  const index = text.indexOf(label);
  if (index < 0) return null;
  const tail = text.slice(index + label.length, index + label.length + 30);
  const matched = tail.match(/(\d+)/);
  return matched ? Number(matched[1]) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "tmall", store: args.store });
  log("天猫概览", "开始", `${args.store}（端口 ${store.port}）`, `读 ${LIST_URL}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${store.port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`端口 ${store.port} 上没有可用的 context`);

  const page = await context.newPage();
  const result = { store: args.store, checkedAt: new Date().toISOString(), url: LIST_URL, stats: {}, pendingTimeout: null };
  try {
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForFunction(() => /24小时内待处理|售后单查询/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    let text = await page.evaluate(() => document.body.innerText);
    for (const label of STAT_LABELS) result.stats[label] = pickNumber(text, label);
    result.stats["退款处理时长(h)"] = (text.match(/退款处理时长[^0-9]{0,8}([\d.]+)/) || [])[1] || null;
    log("天猫概览", "统计读取", Object.entries(result.stats).map(([key, value]) => `${key}=${value}`).join(" "));

    if (args.probePending && result.stats["24小时内待处理"]) {
      await page.getByText("24小时内即将超时", { exact: false }).first().click({ timeout: 15000 }).catch((error) => log("天猫概览", "点筛选失败", error.message));
      await page.waitForTimeout(6000);
      text = await page.evaluate(() => document.body.innerText);
      const empty = /没有符合条件的宝贝/.test(text);
      const ids = Array.from(new Set((text.match(/\b\d{15,20}\b/g) || [])));
      result.pendingTimeout = { listEmpty: empty, ids, textPreview: text.replace(/\s+/g, " ").slice(0, 1200) };
      log("天猫概览", "超时单抓取", empty ? "列表为空" : `发现 ${ids.length} 个编号`, ids.slice(0, 5).join(","));
    }
  } finally {
    await page.close().catch(() => {});
  }

  const outFile = projectPath(args.out || `runtime/tmall/概览-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");
  console.log(`\n  ${result.stats["24小时内待处理"] === 0 ? "✓ 24小时内待处理 = 0（没有签收超 24h 没处理的单）" : `⚠ 24小时内待处理 = ${result.stats["24小时内待处理"]}（要去后台看是哪些单）`}`);
  console.log(`  统计：${Object.entries(result.stats).map(([key, value]) => `${key} ${value}`).join(" ｜ ")}`);
  console.log(`  落盘：${path.relative(projectPath(), outFile)}\n`);
  process.exit(0);
}

main().catch((error) => {
  log("天猫概览", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
