#!/usr/bin/env node
// 50-执行：探域客服后台（merchant.tanyuai.com）给「DEDAKJ京东自营旗舰店（供应商编码:szddkj）」加供应商子账号
//   node 50-执行-驱动.cjs --recon   只读：开页→切到目标店→before 快照（text/截图/DOM/接口）→点「添加供应商子账号」抓弹窗→取消关闭
//   node 50-执行-驱动.cjs --write   写入：before 复核→弹窗填 nick→待提交截图→确定→抓请求/响应→列表与刷新后回读
// 规矩：探域写入 = before 快照 → 小步 → 回读 → 证据落盘；不自动重试；验证码/登录墙停下叫人。
// 画像 C:/Users/b3460/.pi-edge-auto 串行：被占则工具级等待（连续 15s 无该画像浏览器进程）。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLAYWRIGHT = 'D:/桌面/木婉清/22.后台售后服务单分析/node_modules/playwright-core';
const PROFILE = 'C:/Users/b3460/.pi-edge-auto';
const OUT = 'D:/桌面/木婉清/0.木婉清档案/任务证据/2026-10-10-探域新后台未授权';
const BASE = 'https://merchant.tanyuai.com';
const PAGE_URL = BASE + '/turingSubAccount/index';
const 目标店 = 'DEDAKJ京东自营旗舰店（供应商编码:szddkj）';
const 目标店短 = 'DEDAKJ京东自营旗舰店';
const 目标thirdShopId = '2748947084576361329';
const 账号名 = 'dedakj自营--璇璇';

const 模式 = process.argv.includes('--write') ? 'write' : (process.argv.includes('--recon') ? 'recon' : null);
if (!模式) { console.log('用法：node 50-执行-驱动.cjs --recon | --write'); process.exitCode = 1; process.exit(1); }

const 日志f = path.join(OUT, '50-执行-控制台.txt');
fs.appendFileSync(日志f, `\n===== ${new Date().toLocaleString('zh-CN', { hour12: false })} 启动 mode=${模式} =====\n`, 'utf8');
function log(...a) {
  const line = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(line);
  fs.appendFileSync(日志f, line + '\n', 'utf8');
}
function save(name, data) {
  const f = path.join(OUT, name);
  const s = typeof data === 'string' ? data : JSON.stringify(data, null, 1);
  fs.writeFileSync(f, s, 'utf8');
  log(`  落盘 ${name} (${Buffer.byteLength(s)} bytes)`);
}

function 画像空闲() {
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'msedge.exe\'\\" | Where-Object { $_.CommandLine -like \'*pi-edge-auto*\' } | Measure-Object | Select-Object -ExpandProperty Count"', { encoding: 'utf8', timeout: 30000 });
    return parseInt(String(out).trim(), 10) === 0;
  } catch (e) { log('  画像占用检查失败：' + e.message); return true; }
}
async function 等画像空闲() {
  for (let i = 0; i < 40; i++) {
    if (画像空闲()) return;
    log(`  画像被占，第 ${i + 1} 次等待 15s…`);
    await new Promise(r => setTimeout(r, 15000));
  }
  throw new Error('画像长时间被占（>10 分钟），停下等人/等空闲');
}

async function 读头部(page) {
  return page.evaluate(() => {
    const vis = el => !!(el && el.offsetParent !== null);
    const chips = [...document.querySelectorAll('.header-avator-con-item.switch-item')].filter(vis);
    const chip = chips.length ? chips[0] : null;
    const chipText = chip ? (chip.querySelector('span') ? chip.querySelector('span').textContent.trim() : chip.textContent.trim()) : null;
    const buttons = [...document.querySelectorAll('button')].filter(vis).map(b => ({ text: b.textContent.replace(/\s+/g, ' ').trim(), cls: b.className, id: b.id }));
    const icons = [...document.querySelectorAll('i.icon-qiehuan1, i[title="切换店铺"]')].filter(vis).map(i => ({ title: i.getAttribute('title'), cls: i.className }));
    return { url: location.href, title: document.title, chipText, buttons, icons };
  });
}
async function 读列表(page) {
  return page.evaluate(() => {
    const vis = el => !!(el && el.offsetParent !== null);
    const rows = [...document.querySelectorAll('.ant-table-tbody tr.ant-table-row')].filter(vis).map(tr => tr.innerText.replace(/\s+/g, ' ').trim());
    const empty = [...document.querySelectorAll('.ant-empty-description')].filter(vis).map(e => e.textContent.trim());
    const countText = [...document.querySelectorAll('*')].filter(el => vis(el) && /可用子账号数量/.test(el.textContent) && el.children.length === 0).map(el => el.textContent.trim()).slice(0, 3);
    const btns = [...document.querySelectorAll('.ant-btn')].filter(vis).map(b => b.textContent.replace(/\s+/g, ' ').trim());
    return { rows, empty, countText, btns };
  });
}
async function 抓店铺选择器(page) {
  return page.evaluate(() => {
    // 遍历元素找挂载了 Vue 实例的节点，读取子应用/外壳的 Vuex store.shop（= 提交时用的店铺上下文）
    const pick = (vm) => {
      try {
        const s = vm && vm.$store && vm.$store.state && vm.$store.state.shop;
        if (s) return { thirdShopId: s.thirdShopId, shopName: s.shopName, chatbotShopId: s.chatbotShopId, ifJdSelf: s.ifJdSelf, platForm: s.platForm };
      } catch (e) { }
      return null;
    };
    for (const el of document.querySelectorAll('*')) {
      const vm = el.__vue__;
      if (!vm) continue;
      const r = pick(vm) || pick(vm.$root);
      if (r) return r;
    }
    return null;
  });
}

async function 切店(page, 目标) {
  log(`切店：目标「${目标}」`);
  // 打开切换店铺弹窗：点头部店铺切换图标
  const icon = page.locator('.header-avator-con-item.switch-item:visible i.icon-qiehuan1, .header-avator-con-item.switch-item:visible i[title="切换店铺"]').first();
  await icon.waitFor({ state: 'visible', timeout: 10000 });
  await icon.click();
  await page.waitForTimeout(1200);
  const dlg = page.locator('.el-dialog:visible').filter({ hasText: '切换店铺' }).first();
  await dlg.waitFor({ state: 'visible', timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, '50-执行-切换-对话框.png') });
  // 打开 el-select
  await dlg.locator('.el-select').first().click();
  await page.waitForTimeout(600);
  const opts = page.locator('.el-select-dropdown:visible .el-select-dropdown__item');
  const n = await opts.count();
  log(`  店铺下拉候选 ${n} 项`);
  const texts = [];
  for (let i = 0; i < n; i++) texts.push((await opts.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  save('50-执行-切换-候选.json', texts);
  let idx = -1;
  for (let i = 0; i < n; i++) if (texts[i].includes(目标)) { idx = i; break; }
  if (idx < 0) throw new Error(`候选里找不到目标店：${目标}`);
  await opts.nth(idx).click();
  await page.waitForTimeout(400);
  await dlg.locator('button:has-text("切换店铺")').last().click();
  await page.waitForTimeout(4000);
  const chip = (await 读头部(page)).chipText;
  log(`  切换后头部店铺：${chip}`);
  if (!String(chip || '').includes(目标店短)) throw new Error(`切换后头部店铺不符：${chip}`);
  await page.screenshot({ path: path.join(OUT, '50-执行-切换-完成.png') });
  return chip;
}

async function 主() {
  await 等画像空闲();
  log('画像空闲，启动浏览器…');
  const { chromium } = require(PLAYWRIGHT);
  const context = await chromium.launchPersistentContext(PROFILE, { headless: true, channel: 'msedge', viewport: { width: 1680, height: 950 } });
  const page = context.pages()[0] || await context.newPage();

  // 抓接口（只读响应；createSellerAccount 的请求体在 write 模式才出现）
  const api = [];
  page.on('response', async res => {
    const u = res.url();
    if (!/\/api\/(gc|chatbot)\//.test(u)) return;
    if (!/sellerAccount|countSeats|listGroupAllThirdShop/.test(u)) return;
    let body = null;
    try { const t = await res.text(); body = t.length > 20000 ? t.slice(0, 20000) + '…[截断]' : t; } catch { }
    let post = null;
    try { post = res.request().postData(); } catch { }
    api.push({ url: u, status: res.status(), post, body });
  });

  try {
    log(`打开 ${PAGE_URL}`);
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
    await page.waitForTimeout(2500);

    const 头部0 = await 读头部(page);
    log('初始头部：' + 头部0.chipText);
    save('50-执行-before-0-初始头部.json', 头部0);
    await page.screenshot({ path: path.join(OUT, '50-执行-before-0-初始.png') });

    // 切到目标店（若已在则跳过）
    let chip = 头部0.chipText || '';
    if (!chip.includes(目标店短)) chip = await 切店(page, 目标店);

    // before 快照
    const 头部 = await 读头部(page);
    const 列表 = await 读列表(page);
    const store = await 抓店铺选择器(page);
    log('before：店铺=' + 头部.chipText + ' 空表=' + JSON.stringify(列表.empty) + ' 计数=' + JSON.stringify(列表.countText) + ' 按钮=' + JSON.stringify(列表.btns));
    log('before Vuex：' + JSON.stringify(store));
    save('50-执行-before-头部.json', 头部);
    save('50-执行-before-列表.json', 列表);
    save('50-执行-before-Vuex.json', store);
    save('50-执行-before-页面.txt', await page.evaluate(() => document.body.innerText));
    save('50-执行-before-表格.html', await page.evaluate(() => { const t = document.querySelector('.ant-table'); return t ? t.outerHTML : '(无表格)'; }));
    await page.screenshot({ path: path.join(OUT, '50-执行-before-页面.png') });

    // 直读接口（与页面同款，只读）
    const 直读 = await page.evaluate(async (thirdShopId) => {
      const j = async (u, opt) => { const r = await fetch(u, opt); let d = null; try { d = await r.json(); } catch { } return { http: r.status, d }; };
      const list = await j('/api/gc/sellerAccount/querySellerAccountList', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thirdShopId, pageIndex: 1, pageSize: 50 }) });
      const seats = await j('/api/gc/chatbot/countSeats?thirdShopId=' + thirdShopId);
      return { list, seats };
    }, 目标thirdShopId);
    save('50-执行-before-接口.json', 直读);
    log('before 接口：list total=' + (直读.list.d && 直读.list.d.data ? 直读.list.d.data.total : '?') + ' seats=' + JSON.stringify(直读.seats.d && 直读.seats.d.data || null));

    // 点「添加供应商子账号」抓弹窗（只读，不填不交）
    const 供 = page.locator('.ant-btn:visible').filter({ hasText: '添加供应商子账号' }).first();
    if (!(await 供.count())) throw new Error('页面上找不到「添加供应商子账号」按钮（可能当前店不是京东自营）');
    await 供.click();
    await page.waitForTimeout(1200);
    const 弹窗 = page.locator('.ant-modal:visible').first();
    await 弹窗.waitFor({ state: 'visible', timeout: 8000 });
    const 弹窗info = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.ant-modal')].find(x => x.offsetParent !== null);
      if (!m) return null;
      return {
        title: m.querySelector('.ant-modal-title') ? m.querySelector('.ant-modal-title').textContent.trim() : null,
        text: m.innerText,
        inputs: [...m.querySelectorAll('input')].map(i => ({ id: i.id, placeholder: i.placeholder, type: i.type, value: i.value, required: i.getAttribute('aria-required') })),
        buttons: [...m.querySelectorAll('button')].map(b => ({ text: b.textContent.replace(/\s+/g, ' ').trim(), type: b.type, cls: b.className })),
        html: m.outerHTML
      };
    });
    save('50-执行-弹窗.json', 弹窗info);
    log('弹窗：title=' + 弹窗info.title + ' inputs=' + JSON.stringify(弹窗info.inputs) + ' buttons=' + JSON.stringify(弹窗info.buttons.map(b => b.text)));
    await page.screenshot({ path: path.join(OUT, '50-执行-弹窗.png') });

    if (模式 === 'recon') {
      // 关掉弹窗（不写）
      await page.locator('.ant-modal:visible .ant-btn').filter({ hasText: /取\s*消/ }).first().click();
      await page.waitForTimeout(800);
      const 还开着 = await page.locator('.ant-modal:visible').count();
      log('取消后弹窗数=' + 还开着);
      save('50-执行-接口记录.json', api);
      log('recon 结束（未写任何数据）');
      return;
    }

    // ===== write 模式 =====
    if (!String((await 读头部(page)).chipText || '').includes(目标店短)) throw new Error('提交前店铺复核失败：头部不是目标店');
    const store2 = await 抓店铺选择器(page);
    if (store2 && String(store2.thirdShopId) !== 目标thirdShopId) throw new Error('提交前 Vuex 店铺复核失败：' + JSON.stringify(store2));
    if (!store2) log('⚠️ 未能读到 Vuex store（靠头部/列表请求双重校验继续）');
    log('提交前复核：店铺=' + (await 读头部(page)).chipText + ' store=' + JSON.stringify(store2));

    // 弹窗是「添加」而不是「编辑」、输入框唯一
    const 弹窗标题 = await page.locator('.ant-modal:visible .ant-modal-title').first().innerText();
    if (!弹窗标题.includes('添加供应商子账号')) throw new Error('弹窗标题不符：' + 弹窗标题);
    const 输入s = page.locator('.ant-modal:visible .ant-input');
    if (await 输入s.count() !== 1) throw new Error('弹窗输入框数量异常：' + await 输入s.count());
    const 输入 = 输入s.first();
    await 输入.fill(账号名);
    await page.waitForTimeout(500);
    const 填后 = await 输入.inputValue();
    const 页面自己的最近列表请求 = [...api].reverse().find(x => /querySellerAccountList/.test(x.url) && !/pageSize.:50/.test(x.post || ''));
    log('填入 nick=' + JSON.stringify(填后) + '；页面最近列表请求=' + (页面自己的最近列表请求 && 页面自己的最近列表请求.post));
    if (填后 !== 账号名) throw new Error('输入框值不符：' + 填后);
    if (页面自己的最近列表请求 && !String(页面自己的最近列表请求.post).includes(目标thirdShopId)) throw new Error('页面列表请求店铺不是目标店：' + 页面自己的最近列表请求.post);
    save('50-执行-待提交-输入.json', { nick: 填后, thirdShopId: 目标thirdShopId, 店铺: (await 读头部(page)).chipText, 弹窗标题, store: store2 });
    await page.screenshot({ path: path.join(OUT, '50-执行-待提交.png') });

    // 提交
    const 提交前 = new Date();
    await page.locator('.ant-modal:visible button[type="submit"], .ant-modal:visible .ant-btn-primary').filter({ hasText: /确\s*定/ }).first().click();
    log('已点「确定」' + 提交前.toISOString());
    // 等 createSellerAccount 响应（最多 20s）
    for (let i = 0; i < 40; i++) {
      if (api.some(x => /createSellerAccount/.test(x.url))) break;
      await page.waitForTimeout(500);
    }
    const 创建记录 = [...api].reverse().find(x => /createSellerAccount/.test(x.url));
    if (创建记录) log('createSellerAccount：status=' + 创建记录.status + ' post=' + 创建记录.post + ' body=' + String(创建记录.body).slice(0, 300));
    else log('⚠️ 未捕获到 createSellerAccount 请求（可能没发出）');
    save('50-执行-提交请求响应.json', 创建记录 || null);
    await page.waitForTimeout(4000);
    const 提交后body = await page.evaluate(() => document.body.innerText);
    save('50-执行-提交后-页面.txt', 提交后body);
    await page.screenshot({ path: path.join(OUT, '50-执行-提交后.png') });
    const 弹窗还开 = await page.locator('.ant-modal:visible').count();
    log('提交后弹窗数=' + 弹窗还开);

    // 写后回读（接口 + 页面列表）
    await page.waitForTimeout(3000);
    const 回读接口 = await page.evaluate(async (thirdShopId) => {
      const r = await fetch('/api/gc/sellerAccount/querySellerAccountList', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thirdShopId, pageIndex: 1, pageSize: 50 }) });
      let d = null; try { d = await r.json(); } catch { }
      return { http: r.status, d };
    }, 目标thirdShopId);
    save('50-执行-回读-接口.json', 回读接口);
    const 写后列表 = await 读列表(page);
    save('50-执行-回读-列表.json', 写后列表);
    await page.screenshot({ path: path.join(OUT, '50-执行-after-页面.png') });

    // 刷新后再读（防时差）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { });
    await page.waitForTimeout(2500);
    let chipAfter = (await 读头部(page)).chipText || '';
    if (!chipAfter.includes(目标店短)) { log('刷新后店铺=' + chipAfter + '，重切…'); chipAfter = await 切店(page, 目标店); }
    const 刷新回读 = await page.evaluate(async (thirdShopId) => {
      const r = await fetch('/api/gc/sellerAccount/querySellerAccountList', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thirdShopId, pageIndex: 1, pageSize: 50 }) });
      let d = null; try { d = await r.json(); } catch { }
      return { http: r.status, d };
    }, 目标thirdShopId);
    save('50-执行-回读-刷新后-接口.json', 刷新回读);
    save('50-执行-回读-刷新后-列表.json', await 读列表(page));
    save('50-执行-回读-刷新后-页面.txt', await page.evaluate(() => document.body.innerText));
    await page.screenshot({ path: path.join(OUT, '50-执行-回读-刷新后.png') });

    save('50-执行-接口记录.json', api);
    // 关键请求单独存
    const key = api.filter(x => /createSellerAccount/.test(x.url));
    save('50-执行-提交请求响应.json', key);
    log('write 结束；createSellerAccount 记录数=' + key.length);
  } finally {
    await context.close().catch(() => { });
  }
}

主().catch(e => { log('❌ 失败：' + (e && e.stack || e)); process.exitCode = 1; });
