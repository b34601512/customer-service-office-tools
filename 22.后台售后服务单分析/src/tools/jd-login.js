#!/usr/bin/env node
// 京东店铺登录：用 12号/9号 里现成的账号密码自动填（用户 2026-09-18 授权）。
// 规则同天猫：只填一次不重试；**遇到滑块/图片验证码/短信验证一律停下叫用户**。
//
// 用法：node src/tools/jd-login.js --store jd1
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, PROJECT_ROOT } = require("../config/stores");
const { log } = require("../engine/log");

const LOGIN_URL = "https://shop.jd.com/";
const HUMAN_TEXT = ["滑动", "拖动", "验证码", "短信验证", "安全验证", "请完成验证"];
const HUMAN_SELECTOR = ["#JDJRV-slide", ".JDJRV-wrap", ".JDJRV-img", ".J_puzzle"];

function parseArgs(argv) {
  const args = { store: "jd1" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "store") { args.store = argv[index + 1]; index += 1; }
  }
  return args;
}

function readCredentials(storeKey) {
  const candidates = [
    path.join(PROJECT_ROOT, "..", "12.店铺指标数据自动更新", "project-config", "platform-config.json"),
    path.join(PROJECT_ROOT, "..", "9.客服数据自动更新", "project-config", "platform-config.json")
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    let config = null;
    try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const hit = (((config.jd || {}).stores) || []).find((item) => item.key === storeKey);
    if (hit && hit.username && hit.password) {
      return { username: hit.username, password: hit.password, source: path.basename(path.dirname(path.dirname(file))) };
    }
  }
  return null;
}

async function detectHumanCheck(page) {
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  for (const keyword of HUMAN_TEXT) if (text.includes(keyword)) return keyword;
  for (const selector of HUMAN_SELECTOR) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return selector;
  }
  return "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "jd", store: args.store });
  const credentials = readCredentials(args.store);
  if (!credentials) throw new Error(`没在 12号/9号 的 platform-config.json 里找到 ${args.store} 的账号密码`);
  log("京东登录", "开始", `${args.store}（${store.name}）`, `账号 ${credentials.username}（来自 ${credentials.source}）`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${store.port}`).catch(() => null);
  const context = browser ? browser.contexts()[0] : null;
  if (!context) throw new Error(`端口 ${store.port} 上没有窗口（先用 probe-page 拉起 jd1）`);

  const page = await context.newPage();
  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((error) => log("京东登录", "导航失败", error.message));
    await page.waitForTimeout(5000);

    const before = await detectHumanCheck(page);
    if (before) {
      log("京东登录", "需要人工", before);
      console.log(`\n  ⚠ 登录页出现「${before}」——需要你人工处理（窗口已开）\n`);
      process.exit(2);
    }

    const usernameInput = page.locator("#loginname, input[placeholder*='账号']").first();
    const passwordInput = page.locator("input[type='password']").first();
    if (!(await usernameInput.isVisible().catch(() => false)) || !(await passwordInput.isVisible().catch(() => false))) {
      const text = await page.evaluate(() => document.body.innerText).catch(() => "");
      log("京东登录", "没找到输入框", page.url().slice(0, 80), text.replace(/\s+/g, " ").slice(0, 100));
      console.log("\n  ⚠ 没找到账号密码框，请打开窗口看一眼\n");
      process.exit(3);
    }
    await usernameInput.fill(credentials.username);
    await passwordInput.fill(credentials.password);
    log("京东登录", "已填表单", page.url().slice(0, 70));
    const submit = page.locator("button.password__submit").first();
    await submit.click({ timeout: 8000 }).catch((error) => log("京东登录", "点登录失败", error.message));
    await page.waitForTimeout(10000);

    const after = await detectHumanCheck(page);
    const url = page.url();
    if (after) {
      log("京东登录", "需要人工", after, url.slice(0, 80));
      console.log(`\n  ⚠ 提交后出现「${after}」——需要你人工验证（窗口留着，处理完告诉我）\n`);
      process.exit(2);
    }
    if (/shop\.jd\.com/.test(url) && !/passport/.test(url)) {
      log("京东登录", "登录成功", args.store, url.slice(0, 80));
      console.log(`\n  ✓ ${args.store} 登录成功（${url.slice(0, 70)}）\n`);
      process.exit(0);
    }
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    log("京东登录", "结果未知", url.slice(0, 90), text.replace(/\s+/g, " ").slice(0, 90));
    console.log(`\n  ⚠ 结果不确定，当前页面：${url.slice(0, 80)}\n  （若提示账号密码错误，可能是 12号 里存的是店铺备注名而不是登录账号，需要你确认登录账号）\n`);
    process.exit(4);
  } finally {
    await page.close().catch(() => {});
  }
}

main().catch((error) => {
  log("京东登录", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
