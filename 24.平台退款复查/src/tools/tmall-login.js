#!/usr/bin/env node
// 天猫店铺登录：用 9号/12号 项目里现成的账号密码自动登录（用户 2026-09-18 授权）。
//
// 边界（用户明确）：
//   · 只填一次、不重试（失败留现场，按失败台账方针）；
//   · **遇到滑块/图片验证码/短信验证一律停下叫用户**（人工验证必须人来做）；
//   · 密码只在运行时从 9号 的 project-config 读，不在 22号 落第二份。
//
// 用法：node src/tools/tmall-login.js --store tmall2 [--headed]
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath, PROJECT_ROOT } = require("../config/stores");
const { openStoreBrowser } = require("../engine/browser");
const { log } = require("../engine/log");

const LOGIN_URL = "https://qn.taobao.com/home.htm/trade-platform/refund-list";
const HOME_URL_PATTERN = /qn\.taobao\.com/;
const HUMAN_NEEDED_TEXT = ["按住滑块", "拖动滑块", "请完成验证", "滑动验证", "验证码", "短信验证", "扫码"];
const HUMAN_NEEDED_SELECTOR = ["#nc_1_wrapper", ".nc-container", "#nocaptcha", ".baxia-dialog", ".J_Puzzle"];

function parseArgs(argv) {
  const args = { store: "tmall2" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, "");
    if (key === "store") { args.store = argv[index + 1]; index += 1; }
  }
  return args;
}

// 凭据来源：按 9号 → 12号 顺序找同名店铺（用户授权，跨项目只读）
function readCredentials(storeKey) {
  const candidates = [
    path.join(PROJECT_ROOT, "..", "9.客服数据自动更新", "project-config", "platform-config.json"),
    path.join(PROJECT_ROOT, "..", "12.店铺指标数据自动更新", "project-config", "platform-config.json")
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    let config = null;
    try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const stores = ((config.tmall || {}).stores) || [];
    const hit = stores.find((item) => item.key === storeKey);
    if (hit && hit.username && hit.password) {
      return { username: hit.username, password: hit.password, source: path.basename(path.dirname(path.dirname(file))) };
    }
  }
  return null;
}

async function detectHumanCheck(page) {
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  for (const keyword of HUMAN_NEEDED_TEXT) {
    if (text.includes(keyword)) return keyword;
  }
  for (const selector of HUMAN_NEEDED_SELECTOR) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return selector;
  }
  return "";
}

async function fillLoginForm(page, credentials) {
  const frames = page.frames();
  for (const frame of frames) {
    const passwordInput = frame.locator("input[type='password'], input[name*='password'], input[placeholder*='密码']").first();
    if (!(await passwordInput.isVisible().catch(() => false))) continue;
    const usernameInput = frame
      .locator("input[type='text'], input[type='tel'], input[id*='fm-login-id'], input[name*='user'], input[placeholder*='会员名'], input[placeholder*='账号'], input[placeholder*='手机号']")
      .first();
    if (!(await usernameInput.isVisible().catch(() => false))) continue;
    await usernameInput.fill(credentials.username);
    await passwordInput.fill(credentials.password);
    log("天猫登录", "已填表单", frame.url().slice(0, 60));
    const submit = frame.locator("button[type='submit'], .fm-button, .password-login, button:has-text('登录')").first();
    if (await submit.isVisible().catch(() => false)) await submit.click({ timeout: 8000 }).catch((error) => log("天猫登录", "点登录失败", error.message));
    return true;
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = resolveStore({ platform: "tmall", store: args.store });
  const credentials = readCredentials(args.store);
  if (!credentials) throw new Error(`没在 9号/12号 的 platform-config.json 里找到 ${args.store} 的账号密码`);
  log("天猫登录", "开始", `${args.store}（${store.name}）`, `账号 ${credentials.username.slice(0, 2)}***（来自 ${credentials.source}）`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${store.port}`).catch(() => null);
  let context = browser ? browser.contexts()[0] : null;
  if (!context) {
    log("天猫登录", "启动浏览器", `${store.port}`, store.profileDir);
    const session = await openStoreBrowser({ profileDir: store.profileDir, targetUrl: LOGIN_URL, debugPort: store.port, keepOpen: true });
    context = session.context;
  }

  const page = await context.newPage();
  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((error) => log("天猫登录", "导航失败", error.message));
    await page.waitForTimeout(4000);

    const humanCheckBefore = await detectHumanCheck(page);
    if (humanCheckBefore) {
      log("天猫登录", "需要人工", humanCheckBefore, page.url().slice(0, 80));
      console.log(`\n  ⚠ 登录页面出现「${humanCheckBefore}」——需要你人工处理（窗口已打开，请操作后告诉我）\n`);
      process.exit(2);
    }

    const filled = await fillLoginForm(page, credentials);
    if (!filled) {
      const text = await page.evaluate(() => document.body.innerText).catch(() => "");
      log("天猫登录", "没找到登录表单", page.url().slice(0, 80), text.replace(/\s+/g, " ").slice(0, 120));
      console.log(`\n  ⚠ 没找到账号密码输入框（页面：${page.url().slice(0, 80)}）——请打开窗口看一下\n`);
      process.exit(3);
    }

    await page.waitForTimeout(9000);
    const humanCheckAfter = await detectHumanCheck(page);
    const url = page.url();
    if (humanCheckAfter) {
      log("天猫登录", "需要人工", humanCheckAfter, url.slice(0, 80));
      console.log(`\n  ⚠ 提交后出现「${humanCheckAfter}」——需要你人工验证（窗口留着，处理完告诉我）\n`);
      process.exit(2);
    }
    if (HOME_URL_PATTERN.test(url) && !/login/i.test(url)) {
      log("天猫登录", "登录成功", args.store, url.slice(0, 80));
      console.log(`\n  ✓ ${args.store} 登录成功（${url.slice(0, 70)}）\n`);
      process.exit(0);
    }
    log("天猫登录", "结果未知", url.slice(0, 90));
    console.log(`\n  ⚠ 结果不确定，当前页面：${url.slice(0, 90)}（如需人工请处理，窗口留着）\n`);
    process.exit(4);
  } finally {
    await page.close().catch(() => {});
  }
}

main().catch((error) => {
  log("天猫登录", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
