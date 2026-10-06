#!/usr/bin/env node
// X：克隆 CDP(9339) 的 Edge 画像到临时目录，再启动一次 Playwright 浏览器注入登录 cookie 并做登录预检。
// 步骤：① CDP 导出 tanyuai 域 cookie（仅内存）② 复制 Local State / Default/Preferences / Default/Network/Cookies
//       ③ 用 msedge 启动克隆画像 → addCookies → 访问知识卡页并拉一次 page 接口（须 code===1）→ 关闭
// 输出：克隆路径写入 X-克隆路径.txt + stdout（最后一行 PROFILE=…）；不含 cookie 值。
// 收尾：X-清理克隆.cjs（或按路径 rm -rf）。
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const SRC = 'C:/Users/b3460/.pi-edge-auto';
const CDP = 'http://localhost:9339';
const BASE = 'https://agent.tanyuai.com';

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.copyFileSync(from, to);
    return `复制 ${path.basename(from)} ok`;
  } catch (e) {
    return `复制 ${path.basename(from)} 失败（${e.code || e.message}）`;
  }
}
function rmSingleton(dir) {
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch { }
  }
}

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  if (!fs.existsSync(path.join(SRC, 'Local State'))) throw new Error(`源画像不存在：${SRC}`);

  // ① CDP 导出登录 cookie（只在内存）
  const browser = await chromium.connectOverCDP(CDP);
  let cookies;
  try {
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('CDP 无可用 context');
    const all = await ctx.cookies();
    cookies = all.filter(c => /(^|\.)tanyuai\.com$/i.test(String(c.domain)));
    console.log(`CDP 导出 cookie 共 ${all.length} 条，其中 tanyuai 域 ${cookies.length} 条（值不落盘/不打印）`);
    if (!cookies.length) throw new Error('没有 tanyuai 域 cookie，无法克隆登录态');
  } finally { await browser.close().catch(() => { }); }

  // ② 复制画像关键文件
  const clone = path.join(os.tmpdir(), `tanyu-clone-${Date.now()}`);
  fs.mkdirSync(path.join(clone, 'Default', 'Network'), { recursive: true });
  const 复制 = [
    copyFile(path.join(SRC, 'Local State'), path.join(clone, 'Local State')),
    copyFile(path.join(SRC, 'Default', 'Preferences'), path.join(clone, 'Default', 'Preferences')),
    copyFile(path.join(SRC, 'Default', 'Network', 'Cookies'), path.join(clone, 'Default', 'Network', 'Cookies')),
    copyFile(path.join(SRC, 'Default', 'Network', 'Cookies-journal'), path.join(clone, 'Default', 'Network', 'Cookies-journal'))
  ];
  复制.forEach(x => console.log(' ' + x));

  // ③ 启动克隆画像 → 注入 cookie → 登录预检
  const context = await chromium.launchPersistentContext(clone, { headless: true, channel: 'msedge' });
  try {
    await context.addCookies(cookies);
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${BASE}/v2/agent-builder/knowledge-base`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!page.url().startsWith(BASE)) throw new Error(`克隆画像被重定向：${page.url()}`);
    await page.waitForTimeout(3000);
    const r = await page.evaluate(async () => {
      const rr = await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 50 }) });
      let j = null; try { j = await rr.json(); } catch { }
      return { http: rr.status, code: j?.code, total: j?.data?.total ?? null, n: j?.data?.results?.length ?? null };
    });
    console.log(`登录预检：http=${r.http} code=${r.code} total=${r.total} n=${r.n}`);
    if (r.http !== 200 || r.code !== 1) throw new Error('克隆画像登录预检未通过（code!==1）');
  } finally {
    await context.close().catch(() => { });
    rmSingleton(clone);
  }
  fs.writeFileSync(path.join(__dirname, 'X-克隆路径.txt'), clone + '\n', 'utf8');
  console.log(`克隆画像就绪：${clone}`);
  console.log(`PROFILE=${clone}`);
}

main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
