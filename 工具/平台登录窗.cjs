#!/usr/bin/env node
"use strict";
/**
 * 平台登录窗（天猫 / 拼多多）：拉共享层画像开窗、预填账号密码、停在那等人过验证码
 *
 * 为什么有它（黎路遥 2026-11-13）：「天猫8要我登录，你先拉起网页，不是有账号密码吗」
 * 账密本来就在项目 stores.json 里（本机私有、不入库），人只要点验证码/扫码那一步。
 *
 * 用法：
 *   node 工具/平台登录窗.cjs --平台 天猫 --店 tmall8-德达医疗器械旗舰店 --来源 tmall-store-4
 *   node 工具/平台登录窗.cjs --平台 天猫 --店 tmall1-德达旗舰店 --来源 tmall-store-1
 *   node 工具/平台登录窗.cjs --平台 拼多多 --店 pdd02-德达医疗旗舰店 --来源 pdd-store-1
 *
 * 它会：开窗（共享层画像）→ 打开登录页 → 填账号密码 → 打印「等你过验证码」→ 保活（窗口不关）
 * 红线：只做登录，不抓数据、不提交任何业务操作。
 */
const fs = require("fs");
const path = require("path");

const 参数 = process.argv.slice(2);
const 取值 = (名, 默认) => {
  const i = 参数.indexOf(名);
  return i > -1 && 参数[i + 1] ? 参数[i + 1] : 默认;
};
const 平台 = 取值("--平台", "天猫");
const 店键 = 取值("--店", "");
const 来源店 = 取值("--来源", "");

const 项目根 = "D:/硅基公司/员工/05.发票专员·李沅芷/专项/2.发票自动化";
const 平台目录 = { 天猫: "4.天猫发票回传", 拼多多: "5.拼多多发票回传" };
const 平台目录名 = 平台目录[平台];
if (!平台目录名) {
  console.error(`平台只支持：${Object.keys(平台目录).join("、")}`);
  process.exit(1);
}

function 读店(id) {
  const f = path.join(项目根, 平台目录名, "data", "stores.json");
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const 列 = Array.isArray(j) ? j : j.stores || [];
  return 列.find((x) => x.id === id);
}

function 找Playwright() {
  const p = path.join(项目根, "3.通用发票下载中心/node_modules/playwright");
  return require(p);
}

(async () => {
  const { 店铺资料目录 } = require("D:/硅基公司/共享/登录态/目录.cjs");
  const 目录 = 店铺资料目录(平台, 店键);
  const 店 = 来源店 ? 读店(来源店) : null;
  const { chromium } = 找Playwright();
  fs.mkdirSync(目录, { recursive: true });

  const ctx = await chromium.launchPersistentContext(目录, {
    channel: "msedge",
    headless: false,
    viewport: { width: 1440, height: 960 },
    locale: "zh-CN",
  });
  const p = ctx.pages().find((x) => !x.isClosed()) || (await ctx.newPage());
  const 登录页 = 店?.targetUrl || (平台 === "天猫" ? "https://loginmyseller.taobao.com/" : "https://mms.pinduoduo.com/login/");
  await p.goto(登录页, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(2500);
  await p.bringToFront().catch(() => {});
  console.log(`窗口已开：${平台}/${店键}`);
  console.log(`URL=${p.url().slice(0, 80)}`);

  if (店?.username) {
    const 账框 = p.locator('input[name="account"], input[id*="account" i], input[placeholder*="账号"], input[placeholder*="用户名"]').first();
    const 密框 = p.locator('input[type="password"]').first();
    if (await 账框.count()) {
      await 账框.fill(String(店.username)).catch(() => {});
      console.log(`已填账号：${店.username}`);
    } else {
      console.log("⚠ 没找到账号框（页面可能改版）——手动填吧，账号是 " + 店.username);
    }
    if ((await 密框.count()) && 店.password) {
      await 密框.fill(String(店.password)).catch(() => {});
      console.log("已填密码");
    }
  } else {
    console.log("没给 --来源，没预填账密，人手动登。");
  }

  console.log("等你过验证码/扫码；窗口保活不关，登完告我，我核 cookie 落盘。");
  // 保活 + 盯登录成功（窗口被人关掉也不许崩：全包 try）
  let 报过 = false;
  const 截止 = Date.now() + 40 * 60 * 1000;
  while (Date.now() < 截止) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      if (p.isClosed()) {
        console.log("窗口已被关掉。");
        break;
      }
      const u = p.url();
      if (!/login/i.test(u) && !报过) {
        console.log(`✓ 已离开登录页：${u.slice(0, 90)}`);
        报过 = true;
      }
    } catch (e) {
      console.log("页面读不到（可能已关）：" + String(e.message || e).slice(0, 60));
      break;
    }
  }
})();
