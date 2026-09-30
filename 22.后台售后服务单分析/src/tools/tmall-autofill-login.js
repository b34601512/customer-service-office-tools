#!/usr/bin/env node
// 22号：天猫登录页自动填充账号密码（一个动作：填表+点登录；滑块/验证码留给人工）。
//
// 为什么有这个：22号的店铺 profile 登录态会失效，而 9号（客服数据自动更新）里存着同一批账号
//   （project-config/platform-config.json，不入库），用户 2026-09-30 明确「可以从其他项目复制过去账号密码」。
//   本工具只**读**9号（9号没有的店再读 12号）的配置来填表，不复制、不改别人的任何文件。
//
// ⚠️ 2026-09-30 用户现场纠正：账号必须填**整串「主账号:子账号」**（如 德达旗舰店:小黛）——
//   跟 9号/12号 自动登录填的一模一样；曾经按 ':' 切一半只填「小黛」→ 用户看到「完全不对」。
//   找不到店铺 key 时**必须报错，不许拿别家店的账号顶替**（串店=事故）。
//
// 用法：node src/tools/tmall-autofill-login.js --store tmall1 [--account-key tmall1] [--dry]
//   先决条件：该店铺的浏览器已用调试端口拉起（probe-page.js --keepOpen），停在登录页。
// 只读/安全：不点任何后台处理按钮；只填登录表单并点「登录」并回读校验；遇到滑块/验证码立即停手报人。
const { chromium } = require("playwright-core");

// 账号来源（按顺序找）：9号 为主，12号 有 9号 没有的店（如 tmall6 德迩杰）。
const 账号配置来源 = [
  { 来源: "9号", 路径: "D:/桌面/办公软件/9.客服数据自动更新/project-config/platform-config.json" },
  { 来源: "12号", 路径: "D:/桌面/办公软件/12.店铺指标数据自动更新/project-config/platform-config.json" },
];

function 取参数(argv) {
  const 结果 = { store: "tmall1", accountKey: "", dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--store") { 结果.store = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--account-key") { 结果.accountKey = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--dry") { 结果.dry = true; continue; }
  }
  return 结果;
}

// 纯函数，可单测：来源列表默认从 9号/12号 配置文件读；单测里可注入假配置。
function 读账号(accountKey, 来源列表) {
  const 列表 = 来源列表 || 账号配置来源.map((项) => ({
    来源: 项.来源,
    店铺: ((require(项.路径).tmall || {}).stores) || [],
  }));
  for (const 项 of 列表) {
    const 命中 = (项.店铺 || []).find((s) => s.key === accountKey);
    if (!命中) continue;
    // 天猫子账号的登录名就是整串「主账号:子账号」；原样填，不 split。
    const 账号 = String(命中.username || 命中.account || "").trim();
    const 密码 = String(命中.password || "").trim();
    if (!账号 || !密码) throw new Error(`${项.来源}配置里 ${accountKey} 的账号或密码为空`);
    return { 账号, 密码, 来源: `${项.来源}配置的 ${accountKey}` };
  }
  throw new Error(`9号/12号配置里都没有天猫店铺 ${accountKey}：不拿别家店的账号顶替，请人工确认`);
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
  // 回读校验：填完立刻读回输入框的值，确认真的填对了（不打印明文）。
  const [账号回读, 密码回读] = await Promise.all([
    用户框.inputValue().catch(() => ""),
    密码框.inputValue().catch(() => ""),
  ]);
  const 按钮 = await f.$("button[type='submit'], .fm-submit, button:has-text('登录')");
  return {
    填了: true,
    点了登录: Boolean(按钮),
    回读账号一致: 账号回读 === 账号,
    回读账号含冒号: 账号回读.includes(":"),
    回读密码一致: 密码回读 === 密码,
    帧地址: (f.url && f.url()) || "",
  };
}

async function main() {
  const { resolveStore } = require("../config/stores"); // stores.json 不入库，推迟到真正要跑时才 require
  const 参数 = 取参数(process.argv.slice(2));
  const 店铺 = resolveStore({ platform: "tmall", store: 参数.store });
  const { 账号, 密码, 来源 } = 读账号(参数.accountKey || 参数.store);
  console.log(`店铺 ${参数.store}（端口 ${店铺.port}）｜账号来源：${来源}｜账号 ${账号.slice(0, 3)}***（整串格式：主账号:子账号）`);
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
  // 只断开连接即可；Playwright 的 CDP websocket 会让 Node 一直不退出，所以主动 exit（浏览器是 detached 拉起的，不受影响）。
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.log("失败：" + (e && e.message ? e.message : e)); process.exit(1); });
}

module.exports = { 读账号 };
