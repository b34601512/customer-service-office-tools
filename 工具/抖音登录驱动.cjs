#!/usr/bin/env node
"use strict";
/**
 * 抖音店铺登录驱动（短信验证码那条路，2026-11-13 木婉清做）
 *
 * 为什么有它：李沅芷的 `抖音登录助手.js` 只会「开窗 + 停在登录页等人」，不能自己点「发送验证码」。
 * 黎路遥 11-13 明确：抖音不用问他、直接干；验证码发到他手机，他报数字，我填。
 *
 * 流程：开账号浏览器（Edge，复用她的 profile）→ 停在登录页 → 点「验证码/手机号登录」
 *      → 点「获取验证码」→ 打印「码已发」→ 等答案文件 → 填码 → 登录 → 等 URL 离开 /login。
 *
 * 用法：
 *   node 工具/抖音登录驱动.cjs                 # 默认抖音店铺3（douyin-store-1）
 *   node 工具/抖音登录驱动.cjs --店 douyin-store-2
 *   node 工具/抖音登录驱动.cjs --只发码       # 只点发送验证码，不填（人自己在这个窗口里填）
 *
 * 答案文件：`工具/.state/抖音验证码-答案.txt`，内容就 6 位数字（写完我这边等它出现）。
 * 红线：只做登录；不提交发票、不回传、不改店铺设置。撞滑块/风控就停，不重试。
 */
const fs = require("fs");
const path = require("path");

const 她项目 = "D:/硅基公司/员工/05.发票专员·李沅芷/专项/2.发票自动化/6.抖音发票回传";
const { 创建抖音账号浏览器上下文 } = require(path.join(她项目, "src/browser/douyinBrowserContext"));
const { 读取店铺配置 } = require(path.join(她项目, "src/store/storeConfigService"));

const 参数 = process.argv.slice(2);
const 取值 = (名, 默认) => {
  const i = 参数.indexOf(名);
  return i > -1 && 参数[i + 1] ? 参数[i + 1] : 默认;
};
const 店铺Id = 取值("--店", "douyin-store-1");
const 只发码 = 参数.includes("--只发码");

const 答案文件 = path.join(__dirname, ".state", "抖音验证码-答案.txt");
const 登录页 = "https://fxg.jinritemai.com/login/common";
const 目标页 = "https://fxg.jinritemai.com/ffa/morder/receipt/list";

const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
const 是登录页 = (u) => {
  try {
    const x = new URL(String(u || ""));
    return x.hostname === "fxg.jinritemai.com" && x.pathname.startsWith("/login");
  } catch {
    return true;
  }
};

async function 点匹配(page, 模式组, 说明) {
  for (const 模式 of 模式组) {
    for (const 定位 of [
      page.getByText(模式, { exact: false }).first(),
      page.locator(`text=${模式}`).first(),
    ]) {
      try {
        if (await 定位.count() && await 定位.isVisible()) {
          await 定位.click({ timeout: 5000 });
          console.log(`✓ 点到了：${说明}（${模式}）`);
          return true;
        }
      } catch (e) {
        /* 换下一个 */
      }
    }
  }
  console.log(`✗ 没点到：${说明}`);
  return false;
}

(async () => {
  const 店铺 = (读取店铺配置().stores || []).find((s) => s.id === 店铺Id);
  if (!店铺) throw new Error(`没找到店铺配置：${店铺Id}`);

  fs.mkdirSync(path.dirname(答案文件), { recursive: true });
  if (fs.existsSync(答案文件)) fs.unlinkSync(答案文件);

  const context = await 创建抖音账号浏览器上下文(店铺, { headless: false });
  const page = context.pages().find((p) => !p.isClosed()) || (await context.newPage());
  await page.goto(目标页, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.bringToFront().catch(() => {});
  await 等(1500);
  console.log(`店铺=${店铺.name}｜手机=${店铺.phoneNumber || "-"}｜URL=${page.url()}`);

  if (!是登录页(page.url())) {
    console.log("已经是登录态，不用登。");
    await context.close().catch(() => {});
    return;
  }

  await page.goto(登录页, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await 等(2500);
  await page.bringToFront().catch(() => {});

  // 切到手机号/验证码登录（页面文案：密码登录 / 验证码登录 / 手机号登录）
  await 点匹配(page, ["验证码登录", "手机号登录", "短信登录"], "切到验证码登录");
  await 等(1200);

  // 电话号可能有默认值；空了就填
  const 电话框 = page.locator('input[placeholder*="手机"], input[type="tel"], input[placeholder*="电话"]').first();
  if (await 电话框.count()) {
    const 现值 = await 电话框.inputValue().catch(() => "");
    if (!现值 && 店铺.phoneNumber) {
      await 电话框.fill(String(店铺.phoneNumber)).catch(() => {});
      console.log(`已填手机号：${店铺.phoneNumber}`);
    } else {
      console.log(`手机号框现值：${现值 || "（空）"}`);
    }
  } else {
    console.log("⚠ 没找到手机号输入框");
  }

  // 勾协议（有就勾）
  for (const 选择器 of ['input[type="checkbox"]', "text=我已阅读", "text=同意"]) {
    try {
      const 框 = page.locator(选择器).first();
      if (await 框.count() && (await 框.isVisible())) {
        const 选中 = await 框.isChecked().catch(() => true);
        if (!选中) await 框.check({ timeout: 3000 }).catch(() => {});
      }
    } catch (e) {
      /* 忽略 */
    }
  }

  const 发码 = await 点匹配(page, ["获取验证码", "发送验证码", "获取短信验证码"], "获取验证码");
  if (!发码) {
    const 文本 = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
    console.log("页面文本（前 400 字）：" + 文本);
    console.log("停手：没发出验证码，不重试。窗口留着，人可以自己在里面登。");
    return;
  }
  console.log("码已发（注意看手机）");

  if (只发码) {
    console.log("--只发码：窗口留着，等你在窗口里填，本脚本退出。");
    return;
  }

  console.log(`等答案文件：${答案文件}（等内容 6 位数字）`);
  let 码 = "";
  const 截止 = Date.now() + 10 * 60 * 1000;
  while (Date.now() < 截止) {
    await 等(2000);
    if (fs.existsSync(答案文件)) {
      const 文 = fs.readFileSync(答案文件, "utf8").trim();
      if (/^\d{4,8}$/.test(文)) {
        码 = 文;
        fs.unlinkSync(答案文件);
        break;
      }
    }
  }
  if (!码) {
    console.log("等码超时（10 分钟），没提交。窗口留着。");
    return;
  }

  const 码框 = page.locator('input[placeholder*="验证码"], input[placeholder*="短信"]').first();
  if (!(await 码框.count())) {
    console.log("⚠ 没找到验证码输入框，停手。");
    return;
  }
  await 码框.fill(码).catch(() => {});
  await 点匹配(page, ["登录", "立即登录", "登 录"], "提交登录");

  // 等离开登录页
  const 等待到 = Date.now() + 60000;
  while (Date.now() < 等待到) {
    await 等(2000);
    if (!是登录页(page.url())) {
      console.log(`✓ 登录成功，当前 URL=${page.url()}`);
      console.log("✓ 登录态已落在这个账号的浏览器资料目录里，进程退出不影响。");
      await context.close().catch(() => {});
      return;
    }
  }
  const 提示 = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
  console.log(`✗ 60 秒还停在登录页。页面提示：${提示}`);
  console.log("停手，不重试（继续猜码会撞风控）。窗口留着。");
})();
