#!/usr/bin/env node
// 拼多多商家后台登录：账号密码自动填（凭据读 22号本店 → 12号 → 9号）。
// 与天猫/京东同样的规矩：只填一次不重试；**滑块/验证码一律停下叫用户**。
//
// 页面特点（2026-09-18 实测）：默认是「扫码登录」，必须先点「账号登录」才出现输入框
//   · 账号 #usernameId（格式为「主账号:子账号」，如 德达旗舰店:小黛）
//   · 密码 #passwordId
//
// 用法：node src/tools/pdd-login.js --store pdd02
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, PROJECT_ROOT } = require("../config/stores");
const { log } = require("../engine/log");

const LOGIN_URL = "https://mms.pinduoduo.com/login/";
const HUMAN_TEXT = ["滑动", "拖动", "安全验证", "验证码", "短信验证", "请完成验证"];
const HUMAN_SELECTOR = [".nc-container", "#captcha", ".captcha-container", "iframe[src*=captcha]"];

function parseArgs(argv) {
  const args = { store: "pdd02" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "store") { args.store = argv[index + 1]; index += 1; }
  }
  return args;
}

function readCredentials(storeKey, storeConfig) {
  if (storeConfig && storeConfig.username && storeConfig.password) {
    return { username: storeConfig.username, password: storeConfig.password, source: "22号 stores.json" };
  }
  const candidates = [
    path.join(PROJECT_ROOT, "..", "12.店铺指标数据自动更新", "project-config", "platform-config.json"),
    path.join(PROJECT_ROOT, "..", "9.客服数据自动更新", "project-config", "platform-config.json")
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    let config = null;
    try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const hit = (((config.pdd || {}).stores) || []).find((item) => item.key === storeKey);
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
  const store = resolveStore({ platform: "pdd", store: args.store });
  const credentials = readCredentials(args.store, store);
  if (!credentials) throw new Error(`没找到 ${args.store} 的账号密码（22号 stores.json / 12号 / 9号 都没有）`);
  log("拼多多登录", "开始", `${args.store}（${store.name}）`, `账号 ${credentials.username}（来自 ${credentials.source}）`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${store.port}`).catch(() => null);
  const context = browser ? browser.contexts()[0] : null;
  if (!context) throw new Error(`端口 ${store.port} 上没有窗口（先用 probe-page 拉起）`);

  const page = await context.newPage();
  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);

    // 默认是扫码登录 → 先切「账号登录」
    const accountTab = page.getByText("账号登录", { exact: false }).first();
    if (await accountTab.isVisible().catch(() => false)) {
      await accountTab.click({ timeout: 8000 }).catch((error) => log("拼多多登录", "切账号登录 tab 失败", error.message));
      await page.waitForTimeout(4000);
    }
    if (!(await page.locator("#usernameId").isVisible().catch(() => false))) {
      const human = await detectHumanCheck(page);
      log("拼多多登录", human ? "需要人工" : "没有账号表单", human || page.url().slice(0, 80));
      console.log(`\n  ⚠ 登录页当前不是账号登录表单${human ? `（出现「${human}」需要你人工处理）` : ""}，窗口已开着，请看一眼\n`);
      process.exit(human ? 2 : 3);
    }

    await page.locator("#usernameId").fill(credentials.username);
    await page.locator("#passwordId").fill(credentials.password);
    log("拼多多登录", "已填表单", credentials.username, page.url().slice(0, 60));

    let clicked = false;
    for (const selector of ["button:has-text('登录')", "div[class*=loginBtn]", "div[class*=login-btn]", "button[type=submit]"]) {
      const target = page.locator(selector).first();
      if (await target.isVisible().catch(() => false)) {
        await target.click({ timeout: 8000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      log("拼多多登录", "没找到登录按钮", "改用回车提交");
      await page.locator("#passwordId").press("Enter").catch(() => {});
    }
    await page.waitForTimeout(10000);

    const human = await detectHumanCheck(page);
    const url = page.url();
    if (human) {
      log("拼多多登录", "需要人工", human, url.slice(0, 80));
      console.log(`\n  ⚠ 提交后出现「${human}」——需要你人工验证（窗口留着，处理完告诉我）\n`);
      process.exit(2);
    }
    if (!/\/login/.test(url)) {
      log("拼多多登录", "登录成功", args.store, url.slice(0, 80));
      console.log(`\n  ✓ ${args.store} 登录成功（${url.slice(0, 70)}）\n`);
      process.exit(0);
    }
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    log("拼多多登录", "结果未知", url.slice(0, 90), text.replace(/\s+/g, " ").slice(0, 110));
    console.log(`\n  ⚠ 结果不确定，当前页面：${url.slice(0, 80)}\n  （若提示账号或密码错误，请确认 12号 里 pdd 的账号密码）\n`);
    process.exit(4);
  } finally {
    await page.close().catch(() => {});
  }
}

main().catch((error) => {
  log("拼多多登录", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
