#!/usr/bin/env node
// 4号：只读读取天猫「待回传发票」某一行订单的**发票详情**（抬头/税号/票种/金额）。
// 用途：7号自动登记发票要写 AA 列（发票抬头）和 AB 列（发票税号），而列表页不给税号 → 必须开详情。
// **只读**：只打开列表页、点该行「详情」、读弹层文本；不点「同意」、不提交、不改任何数据（天猫待同意红线）。
//
// 用法：
//   node scripts/读发票详情.js --店铺 tmall-store-3 --订单 5127724117341157631
//   node scripts/读发票详情.js --店铺 tmall-store-3 --订单 5127724117341157631 --out runtime/发票详情-xxx.json
// 产物：runtime/天猫发票详情-<订单号>.json（原始弹层文本 + 提取结果），拿不到弹层就退化为「整页文本片段」并标注。
const fs = require("fs");
const path = require("path");
const { 读取店铺配置, 获取指定或首个启用店铺 } = require("../src/store/storeConfigService");
const { 创建天猫店铺浏览器上下文 } = require("../src/browser/tmallBrowserContext");
const { 打开天猫待回传发票页面 } = require("../src/invoiceReturn/tmallInvoicePage");

const 项目根 = path.resolve(__dirname, "..");

function 解析参数(argv) {
  const 结果 = {};
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--店铺") { 结果.店铺 = argv[i + 1]; i += 1; continue; }
    if (词 === "--订单") { 结果.订单 = argv[i + 1]; i += 1; continue; }
    if (词 === "--out") { 结果.out = argv[i + 1]; i += 1; continue; }
  }
  if (!结果.订单) throw new Error("缺少 --订单 <订单号>");
  return 结果;
}

function 提取(text) {
  const 正文 = String(text || "").replace(/\s+/g, " ").trim();
  return {
    抬头: (正文.match(/抬头[:：]?\s*([^\s:：]{2,60})/) || [])[1] || "",
    税号: (正文.match(/(?:税号|纳税人识别号)[:：]?\s*([A-Za-z0-9]{15,20})/) || [])[1] || "",
    票种: (正文.match(/(增值税专用发票|增值税电子普通发票|增值税普通发票)/) || [])[1] || "",
    金额: (正文.match(/(?:金额|价税合计)[:：]?\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/) || [])[1] || "",
  };
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 配置 = 读取店铺配置();
  const 全部店铺 = Array.isArray(配置) ? 配置 : (配置.stores || []);
  const 店铺 = 参数.店铺
    ? 全部店铺.find((s) => s.id === 参数.店铺)
    : 获取指定或首个启用店铺();
  if (!店铺) throw new Error(`没找到店铺配置：${参数.店铺 || "(首个启用店铺)"}（现有：${全部店铺.map((s) => s.id).join(", ")}）`);
  console.log(`  店铺：${店铺.name}（${店铺.id}）　订单：${参数.订单}`);

  const 上下文 = await 创建天猫店铺浏览器上下文(店铺, { headless: false });
  const 现场 = { 时间: new Date().toISOString(), 店铺: 店铺.name, 店铺id: 店铺.id, 订单: 参数.订单, 弹层文本: "", 提取: {}, 说明: "" };
  try {
    const 页面 = 上下文.pages().find((p) => !p.isClosed()) || await 上下文.newPage();
    await 打开天猫待回传发票页面(页面, 店铺);
    const 行 = 页面.locator("tr", { hasText: 参数.订单 }).first();
    await 行.waitFor({ state: "visible", timeout: 20_000 });
    const 详情入口 = 行.getByText("详情", { exact: true }).first();
    await 详情入口.click({ timeout: 10_000 });
    // 弹层结构未知 → 多选择器都试一遍，拿到哪个用哪个（拿不到就退化读整页，绝不猜值）。
    const 候选 = ['[role="dialog"]', '[class*="dialog" i]', '[class*="Dialog"]', '[class*="modal" i]', '.next-overlay-inner'];
    let 弹层文本 = "";
    for (const 选择器 of 候选) {
      const 层 = 页面.locator(选择器).first();
      if (await 层.count() === 0) continue;
      const 文本 = await 层.innerText({ timeout: 5000 }).catch(() => "");
      if (String(文本).trim().length > 10) { 弹层文本 = String(文本); break; }
    }
    if (!弹层文本) {
      现场.说明 = "没读到弹层，退化为整页文本里截订单号附近片段（仅供人工核对，值不入库）";
      const 整页 = await 页面.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
      const 位置 = String(整页).indexOf(参数.订单);
      弹层文本 = 位置 >= 0 ? String(整页).slice(Math.max(0, 位置 - 200), 位置 + 1200) : String(整页).slice(0, 1200);
    }
    现场.弹层文本 = 弹层文本.replace(/\s+/g, " ").trim().slice(0, 4000);
    现场.提取 = 提取(弹层文本);
    await 页面.keyboard.press("Escape").catch(() => {});
  } finally {
    await 上下文.close().catch(() => {});
  }

  const 输出 = 参数.out ? path.resolve(项目根, 参数.out) : path.join(项目根, "runtime", `天猫发票详情-${String(参数.订单).replace(/[^\w-]/g, "_")}.json`);
  fs.mkdirSync(path.dirname(输出), { recursive: true });
  fs.writeFileSync(输出, JSON.stringify(现场, null, 2), "utf8");

  console.log(`  抬头：${现场.提取.抬头 || "（未提取到）"}`);
  console.log(`  税号：${现场.提取.税号 || "（未提取到）"}`);
  console.log(`  票种：${现场.提取.票种 || "（未提取到）"}　金额：${现场.提取.金额 || "（未提取到）"}`);
  if (现场.说明) console.log(`  说明：${现场.说明}`);
  console.log(`  证据：${path.relative(项目根, 输出)}`);
  if (!现场.提取.税号) process.exitCode = 3;
}

main().catch((错误) => {
  console.error(`\n  读取失败：${错误.message}\n`);
  process.exit(1);
});
