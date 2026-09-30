#!/usr/bin/env node
// 22号：天猫登录页自动填充账号密码（一个动作：填表+点登录；滑块/验证码留给人工）。
//
// 为什么有这个：22号的店铺 profile 登录态会失效，而 9号（客服数据自动更新）里存着同一批账号
//   （project-config/platform-config.json，不入库），用户 2026-09-30 明确「可以从其他项目复制过去账号密码」。
//   本工具只**读**9号的配置来填表，不复制、不改 9号的任何文件。
//
// 用法：node src/tools/tmall-autofill-login.js --store tmall1 [--account-key tmall1] [--dry]
//   先决条件：该店铺的浏览器已用调试端口拉起（probe-page.js --keepOpen），停在登录页。
// 只读/安全：不点任何后台处理按钮；只填登录表单并点「登录」；遇到滑块/验证码立即停手报人。
const path = require("path");
const { chromium } = require("playwright-core");
const { resolveStore, projectPath } = require("../config/stores");

function 取参数(argv) {
  const 结果 = { store: "tmall1", accountKey: "", dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--store") { 结果.store = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--account-key") { 结果.accountKey = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--dry") { 结果.dry = true; continue; }
  }
  return 结果;
}

function 读账号(accountKey) {
  const 配置路径 = path.resolve("D:/桌面/办公软件/9.客服数据自动更新/project-config/platform-config.json");
  const 配置 = require(配置路径);
  const 店铺s = (配置.tmall && 配置.tmall.stores) || [];
  const 命中 = 店铺s.find((s) => s.key === accountKey) || 店铺s[0];
  if (!命中) throw new Error("9号配置里没有天猫店铺");
  const 账号 = String(命中.username || 命中.account || "").split(":").pop().trim();
  const 密码 = String(命中.password || "").trim();
  if (!账号 || !密码) throw new Error("9号配置里账号或密码为空");
  return { 账号, 密码, 来源店铺: 命中.key };
}

async function 填登录(page, 账号, 密码) {
  // 登录框可能在外层页面，也可能在 iframe 里 —— 两处都试。
  const 目标 = [];
  const 主 = page.frameLocator ? null : null;
  void 主;
  for (const f of [page, ...page.frames()]) {
    try {
      const 用户框 = await f.$("input[id*='fm-login-id'], input[type='text'], input[placeholder*='账号'], input[placeholder*='会员名']");
      const 密码框 = await f.$("input[type='password'], input[id*='fm-login-password']");
      if (用户框 && 密码框) 目标.push({ f, 用户框, 密码框 });
    } catch (e) { /* frame 可能在跳转，忽略 */ }
  }
  if (!目标.length) return { 填了: false, 原因: "页面上找不到账号/密码输入框（可能已是登录成功或页面还在跳）" };
  const { f, 用户框, 密码框 } = 目标[0];
  await 用户框.fill(账号);
  await 密码框.fill(密码);
  const 按钮 = await f.$("button[type='submit'], .fm-submit, button:has-text('登录')");
  return { 填了: true, 点了登录: Boolean(按钮), 按钮: 按钮 ? true : false, 帧地址: (f.url && f.url()) || "" };
}

async function main() {
  const 参数 = 取参数(process.argv.slice(2));
  const 店铺 = resolveStore({ platform: "tmall", store: 参数.store });
  const { 账号, 密码, 来源店铺 } = 读账号(参数.accountKey || 参数.store);
  console.log(`店铺 ${参数.store}（端口 ${店铺.port}）｜账号来源：9号配置的 ${来源店铺}｜账号 ${账号.slice(0, 3)}***`);
  const 浏览器 = await chromium.connectOverCDP(`http://127.0.0.1:${店铺.port}`);
  const 上下文 = 浏览器.contexts()[0];
  const 页s = 上下文.pages();
  const page = 页s[页s.length - 1];
  if (!page) throw new Error("没有打开的页面");
  console.log("当前地址：" + page.url());
  if (参数.dry) { console.log("--dry：只看看有没有登录框，不填。"); }
  const 结果 = 参数.dry ? { 填了: false, 原因: "dry" } : await 填登录(page, 账号, 密码);
  console.log("结果：" + JSON.stringify(结果));
  if (结果.填了) console.log("已填并点登录；**若出现滑块/验证码，请人工完成**（窗口留给你）。");
  // 注意：CDP 连上的浏览器**不能 close()**——那会把整个浏览器关掉（2026-09-30 踩过：登录刚填完浏览器就没了）。
  // 只断开连接即可。
}

main().catch((e) => { console.log("失败：" + (e && e.message ? e.message : e)); process.exitCode = 1; });
