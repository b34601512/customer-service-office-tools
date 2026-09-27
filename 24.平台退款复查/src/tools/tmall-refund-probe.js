#!/usr/bin/env node
// 天猫售后详情批量探针：给一串售后单号，逐单开【新标签页】抓详情（倒计时 + 退货物流文案），落盘 JSON。
// 只负责"把现场搬回来"，不做判漏判断（判断交给调用方）。
//
// 为什么要新标签页：淘宝后台是 SPA，复用同一标签页做 goto 时页面不响应（实测 2026-09-18，
//   连抓 10 次拿到的是同一单的内容），必须每单新开标签。
//
// 用法：
//   node src/tools/tmall-refund-probe.js --store tmall1 --ids 407319804404762740,285384325865899996
//   node src/tools/tmall-refund-probe.js --store tmall1 --ids-file runtime/tmall/10个待查.txt
//   node src/tools/tmall-refund-probe.js --store tmall1 --ids-file x.txt --out runtime/tmall/详情.json
//
// 只读：只做 page.goto + 读 innerText，不点任何按钮、不提交任何东西。
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");
const { log } = require("../engine/log");

const DETAIL_URL = "https://qn.taobao.com/home.htm/trade-platform/refund-list/detail?disputeId={id}&type=1";

function parseArgs(argv) {
  const args = { store: "tmall1", settleMs: 2500 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    const value = argv[index + 1];
    if (key === "ids") { args.ids = String(value || "").split(",").map((item) => item.trim()).filter(Boolean); index += 1; continue; }
    if (key === "ids-file") { args.idsFile = value; index += 1; continue; }
    if (key === "store") { args.store = value; index += 1; continue; }
    if (key === "out") { args.out = value; index += 1; continue; }
    if (key === "settle-ms") { args.settleMs = Number(value); index += 1; }
  }
  if (args.idsFile) {
    args.ids = fs.readFileSync(projectPath(args.idsFile), "utf8").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }
  if (!args.ids || !args.ids.length) throw new Error("没有售后单号（--ids 或 --ids-file）");
  return args;
}

function extractFields(text, capturedAt) {
  const progress = text.match(/还剩\s*(?:(\d+)\s*天)?\s*(\d+)\s*时\s*(\d+)\s*分/);
  let remainHours = null;
  if (progress) remainHours = Number(progress[1] || 0) * 24 + Number(progress[2]) + Number(progress[3]) / 60;
  const logistics = text.match(/退货物流信息[:：]\s*([^\n]{0,80})/);
  const logisticsText = logistics ? logistics[1].replace(/\s+/g, " ").trim() : "";
  // 天猫规则：当退件显示签收/拒收且剩余处理时长＞48 小时，剩余会缩短为 48 小时
  //   → 剩余 ≤ 48h 即视为已签收；签收时刻 ≈ 现在 −（48h − 剩余）
  let signedAt = null;
  if (remainHours !== null && remainHours <= 48) {
    signedAt = new Date(capturedAt.getTime() - (48 - remainHours) * 3600 * 1000).toISOString();
  }
  const signedByText = /已签收|签收成功|派送成功|已拒收/.test(logisticsText);
  return { remainHours, signedByText, signedAt, logisticsText };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "tmall", store: args.store });
  log("天猫详情", "开始", `${args.store}（端口 ${store.port}）`, `${args.ids.length} 单`, "每单新标签页");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${store.port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`端口 ${store.port} 上没有可用的 context`);

  const results = [];
  for (const id of args.ids) {
    const capturedAt = new Date();
    const record = { refundId: id, capturedAt: capturedAt.toISOString(), url: DETAIL_URL.replace("{id}", id) };
    let page = null;
    try {
      page = await context.newPage();
      await page.goto(record.url, { waitUntil: "domcontentloaded", timeout: 40000 });
      await page
        .waitForFunction(() => /还剩|退货物流信息|签收|派送成功|退款完毕|已退款/.test(document.body.innerText), { timeout: 30000 })
        .catch(() => {});
      await page.waitForTimeout(args.settleMs);
      const text = await page.evaluate(() => document.body.innerText);
      record.finalUrl = page.url();
      record.textLength = text.length;
      Object.assign(record, extractFields(text, capturedAt));
      record.textPreview = text.replace(/\s+/g, " ").slice(0, 260);
      const remainText = record.remainHours === null ? "无倒计时" : `${record.remainHours.toFixed(1)}h`;
      const signText = record.signedAt ? `推算签收 ${record.signedAt.slice(5, 16).replace("T", " ")}` : (record.signedByText ? "文案显示已签收" : "未签收");
      log("天猫详情", "抓取成功", `${id} 剩余 ${remainText}`, signText);
    } catch (error) {
      record.error = error.message;
      log("天猫详情", "抓取失败", id, error.message);
    } finally {
      if (page) await page.close().catch(() => {});
    }
    results.push(record);
  }

  const outFile = projectPath(args.out || `runtime/tmall/详情批量-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), store: args.store, results }, null, 2), "utf8");
  console.log(`\n  已抓 ${results.length} 单，成功 ${results.filter((item) => !item.error).length} 单`);
  console.log(`  落盘：${path.relative(projectPath(), outFile)}\n`);
  // 注意：不调用 browser.close()——这是别人正在用的窗口，只断开连接即可
  process.exit(0);
}

main().catch((error) => {
  log("天猫详情", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
