#!/usr/bin/env node
"use strict";
/**
 * ERP（管易云）验证码填码器 —— 照诺诺那套「截图 → 模型看图 → 写答案 → 脚本填码」
 *
 * 为什么有它（黎路遥 2026-11-13）：「那个发票专员不是已经会弄如何自动登录诺诺了吗，就是识别验证码的方法，
 * 你让 ERP 系统这个登录也照做，后面自动登录吧，免得老要人登。」
 *
 * 分工：账号密码由已有脚本负责（03 号 `自动登录ERP.cjs` 会填账密、遇验证码就停），
 *      本工具只干「验证码这一格」：截图 → 等答案 → 填 → 提交 → 验登录。
 *
 * 用法：
 *   node 工具/ERP验证码.cjs                 # 附着本机 Edge 调试端口 9446（03 号专用浏览器）
 *   node 工具/ERP验证码.cjs --端口 9450
 *   node 工具/ERP验证码.cjs --只截图        # 只存图给我看，不填不交（排障用）
 *
 * 答案文件：`工具/.state/erp验证码-答案.txt`，内容就是验证码字符（4~6 位）。
 * 红线：只做登录；连续两次提示验证码错误就停手（防锁号），不重试不猜。
 */
const fs = require("fs");
const path = require("path");

const 参数 = process.argv.slice(2);
const 取值 = (名, 默认) => {
  const i = 参数.indexOf(名);
  return i > -1 && 参数[i + 1] ? 参数[i + 1] : 默认;
};
const 端口 = 取值("--端口", "9446");
const 只截图 = 参数.includes("--只截图");

const 图路径 = path.join(__dirname, ".state", "erp验证码.png");
const 答案路径 = path.join(__dirname, ".state", "erp验证码-答案.txt");
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

function 找Playwright() {
  const 候选 = [
    "D:/硅基公司/员工/05.发票专员·李沅芷/专项/2.发票自动化/3.通用发票下载中心/node_modules/playwright",
    "D:/硅基公司/员工/03.巡检员·霍青桐/专项/ERP未审核检查/node_modules/playwright",
  ];
  for (const p of 候选) if (fs.existsSync(p)) return require(p);
  throw new Error("没找到 playwright（检查 03/05 号项目的 node_modules）");
}

(async () => {
  const { chromium } = 找Playwright();
  let 浏览器;
  try {
    浏览器 = await chromium.connectOverCDP(`http://127.0.0.1:${端口}`);
  } catch (e) {
    console.error(`✗ 连不上调试端口 ${端口}：先把 ERP 浏览器开起来（03 号：node scripts/启动浏览器.cjs）`);
    process.exit(2);
  }

  const 上下文 = 浏览器.contexts()[0];
  const 页 = 上下文.pages().find((p) => /guanyierp\.com/.test(p.url()))
    || (await 上下文.newPage());
  if (!/guanyierp\.com/.test(页.url())) {
    await 页.goto("https://login.guanyierp.com/login?webType=main", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await 等(2500);
  }
  console.log(`当前页：${页.url()}`);

  const 码框 = 页.locator('input[placeholder*="验证码"], input[name*="captcha" i], input[id*="captcha" i]').first();
  if (!(await 码框.count())) {
    console.log("✓ 页面上没有验证码输入框（可能已登录，或还没点到「账户登录」）。");
    console.log("  没登录时请先跑 03 号 `自动登录ERP.cjs` 让它把账密填上、停在验证码这步。");
    await 浏览器.close().catch(() => {});
    process.exit(3);
  }

  fs.mkdirSync(path.dirname(图路径), { recursive: true });
  await 页.screenshot({ path: 图路径 }).catch(() => {});
  // 再单独截验证码小图（有 <img> 就截它，模型看得更清楚）
  let 小图 = "";
  const 验证码图 = 页.locator('img[src*="captcha" i], img[src*="verify" i], img[alt*="验证码"]').first();
  if (await 验证码图.count()) {
    小图 = path.join(__dirname, ".state", "erp验证码-小图.png");
    await 验证码图.screenshot({ path: 小图 }).catch(() => { 小图 = ""; });
  }
  console.log(`图已存：${图路径}${小图 ? "｜小图：" + 小图 : ""}`);
  if (只截图) {
    await 浏览器.close().catch(() => {});
    return;
  }

  if (fs.existsSync(答案路径)) fs.unlinkSync(答案路径);
  console.log(`等你写答案：${答案路径}（内容就是验证码字符）`);
  const 截止 = Date.now() + 10 * 60 * 1000;
  let 码 = "";
  while (Date.now() < 截止) {
    await 等(2000);
    if (fs.existsSync(答案路径)) {
      const 文 = fs.readFileSync(答案路径, "utf8").trim();
      if (/^[A-Za-z0-9]{3,8}$/.test(文)) {
        码 = 文;
        fs.unlinkSync(答案路径);
        break;
      }
    }
  }
  if (!码) {
    console.log("等答案超时（10 分钟），没提交。");
    await 浏览器.close().catch(() => {});
    process.exit(4);
  }

  await 码框.fill(码).catch(() => {});
  const 登录按钮 = 页.getByRole("button", { name: /登录/ }).first();
  if (await 登录按钮.count()) await 登录按钮.click({ timeout: 8000 }).catch(() => {});
  else await 页.keyboard.press("Enter").catch(() => {});

  const 等待到 = Date.now() + 45000;
  while (Date.now() < 等待到) {
    await 等(2000);
    if (/v2\.guanyierp\.com/.test(页.url())) {
      console.log(`✓ 登录成功：${页.url()}`);
      await 浏览器.close().catch(() => {});
      return;
    }
    const 文本 = (await 页.innerText("body").catch(() => "")).replace(/\s+/g, " ");
    if (/验证码.{0,6}(错误|不正确|失效)/.test(文本)) {
      console.log("✗ 验证码错了。停手，不连续试（防锁号）；要重来请重新截图。");
      await 浏览器.close().catch(() => {});
      process.exit(5);
    }
  }
  console.log(`✗ 45 秒没进后台，当前 ${页.url()}（窗口留着，人可接手）`);
  await 浏览器.close().catch(() => {});
  process.exit(6);
})();
