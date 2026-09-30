#!/usr/bin/env node
// 22号：拼多多登录页自动填充账号密码（一个动作：切「账号登录」→ 填表 → 点登录 → 回读；滑块/短信验证码留人工）。
//
// 为什么有这个：用户 2026-09-30 明确「拼多多你账号密码都没填写好，你自己看看别的项目怎么自动化登录的吧，9号」
//   —— 9号 的拼多多登录协助就是这么填的（pddLoginLocators.js：切账号登录面 + 填账号密码）。
//   账号来源：9号 → 12号 配置（tmall-autofill-login.js 同一套 login-account-source）。
// ⚠️ 拼多多子账号登录名也是**整串「主账号:子账号」**（如 德达旗舰店:小黛），原样填，不许 split。
//
// 用法：node src/tools/pdd-autofill-login.js --store pdd02 [--account-key pdd02] [--dry]
//   先决条件：该店铺浏览器已用调试端口拉起（probe-page.js --keepOpen），停在 mms.pinduoduo.com 登录页。
// 只读/安全：只碰登录表单；不点任何后台处理按钮；滑块/验证码留人工。
const { chromium } = require("playwright-core");
const { 读账号 } = require("./login-account-source");

function 取参数(argv) {
  const 结果 = { store: "pdd02", accountKey: "", dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--store") { 结果.store = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--account-key") { 结果.accountKey = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--dry") { 结果.dry = true; continue; }
  }
  return 结果;
}

async function 切到账号登录(page) {
  // 拼多多登录页默认停在「扫码登录」，要切到「账号登录」才有输入框。
  const 候选 = [
    page.getByText("账号登录", { exact: true }),
    page.locator("text=账号登录"),
  ];
  for (const 元素 of 候选) {
    try {
      const 一个 = 元素.first();
      if ((await 一个.count()) > 0 && (await 一个.isVisible())) {
        await 一个.click({ timeout: 8000 });
        await page.waitForTimeout(1500);
        if (await page.$("#usernameId")) return true;
      }
    } catch (e) { /* 换下一个候选 */ }
  }
  return Boolean(await page.$("#usernameId"));
}

async function 点登录(page) {
  const 按钮s = await page.$$("button");
  for (const 按钮 of 按钮s) {
    const 文本 = ((await 按钮.innerText().catch(() => "")) || "").trim();
    if (文本 !== "登录") continue;
    if (!(await 按钮.isVisible().catch(() => false))) continue;
    await 按钮.click({ timeout: 8000 }).catch(() => {});
    return true;
  }
  return false;
}

async function 填登录(page, 账号, 密码) {
  if (!(await page.$("#usernameId")) || !(await page.$("#passwordId"))) {
    const 切好 = await 切到账号登录(page);
    if (!切好) return { 填了: false, 原因: "找不到账号/密码输入框（可能已登录成功或页面还在跳）" };
  }
  await page.fill("#usernameId", 账号);
  await page.fill("#passwordId", 密码);
  // 回读校验：确认真的填对了（不打印明文）。
  const [账号回读, 密码回读] = await Promise.all([
    page.inputValue("#usernameId").catch(() => ""),
    page.inputValue("#passwordId").catch(() => ""),
  ]);
  const 点了登录 = await 点登录(page);
  return {
    填了: true,
    点了登录,
    回读账号一致: 账号回读 === 账号,
    回读账号含冒号: 账号回读.includes(":"),
    回读密码一致: 密码回读 === 密码,
    地址: page.url(),
  };
}

async function main() {
  const { resolveStore } = require("../config/stores"); // stores.json 不入库，推迟到真正要跑时才 require
  const 参数 = 取参数(process.argv.slice(2));
  const 店铺 = resolveStore({ platform: "pdd", store: 参数.store });
  const { 账号, 密码, 来源 } = 读账号("pdd", 参数.accountKey || 参数.store);
  console.log(`店铺 ${参数.store}（端口 ${店铺.port}）｜账号来源：${来源}｜账号 ${账号.slice(0, 3)}***（整串格式：主账号:子账号）`);
  const 浏览器 = await chromium.connectOverCDP(`http://127.0.0.1:${店铺.port}`);
  const 上下文 = 浏览器.contexts()[0];
  const 页s = 上下文.pages().filter((p) => !p.isClosed());
  const page = 页s.find((p) => /mms\.pinduoduo\.com/.test(p.url())) || 页s[页s.length - 1];
  if (!page) throw new Error("没有打开的页面");
  console.log("当前地址：" + page.url());
  if (参数.dry) { console.log("--dry：只看看有没有登录框，不填。"); }
  const 结果 = 参数.dry ? { 填了: false, 原因: "dry" } : await 填登录(page, 账号, 密码);
  console.log("结果：" + JSON.stringify(结果));
  if (结果.填了) console.log("已填并点登录；**若出现滑块/短信验证码，请人工完成**（窗口留给你）。");
  // CDP 连上的浏览器不能 close()（会关掉整个窗口）；Playwright 的 websocket 会让进程不退出 → 主动 exit。
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.log("失败：" + (e && e.message ? e.message : e)); process.exit(1); });
}

module.exports = {};
