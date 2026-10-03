#!/usr/bin/env node
// 意图：探域「调优工坊 → 知识审核」队列的受控处理（只读列表 + 标记已处理），默认 dry-run。
// 背景：调优工坊把客服对话里提炼的 Q&A 放进「知识审核」队列（approvalStatus 1=待审核 2=已处理），
//       需要人/模型逐条核对（口径、是否答错）后再标记。标记**不改知识本身**（实测 active 不受影响）。
//
// 接口（2026-10-03 从前端 JS 实测）：
//   列表 GET  /api/copilot/v1/knowledge/chat-log-review/paginate?thirdShopId&pageIndex&pageSize
//   明细 GET  /api/copilot/v1/knowledge/chat-log-review/detail?id&thirdShopId
//   标记 POST /api/copilot/v1/knowledge/chat-log-review/approve  body {id}      ← 只认 id，一次一条
//
// 用法：
//   node 探域调优坊审核.cjs --base-url "https://agent.tanyuai.com" --profile "<登录画像>" \
//     --playwright-core-path "<playwright-core>" --browser-channel msedge \
//     --list [--shops "id1,id2" | --all] [--out-dir "<证据目录>"]
//   node 探域调优坊审核.cjs ... --approve "id1,id2" [--commit]
//
// 缺省行为：--approve 不带 --commit 只打印将标记的清单；--all 用「商品学习配置」里的店铺列表（不写死店铺）。
// 铁律：只读列表可随便跑；标记前必须逐条看过内容（口径对不上→先改知识再标记，拿不准→问黎路遥）。
'use strict';
const fs = require('fs');
const path = require('path');

function argument(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function required(name) {
  const v = argument(name);
  if (!v) throw new Error(`缺少参数 ${name}`);
  return v;
}

async function 页面内请求(page, endpoint, method, body) {
  return page.evaluate(async ({ endpoint, method, body }) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(endpoint, {
        method, credentials: 'include', signal: ctl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      let json = null; try { json = await r.json(); } catch { /* 非 JSON */ }
      return { httpStatus: r.status, json };
    } finally { clearTimeout(timer); }
  }, { endpoint, method, body });
}

async function 读店铺列表(page) {
  const r = await 页面内请求(page, '/api/copilot/product-learning/config/page?pageIndex=1&pageSize=100', 'GET');
  if (r.httpStatus !== 200 || r.json?.code !== 1) throw new Error(`读店铺列表失败 http=${r.httpStatus} code=${r.json?.code}`);
  return (r.json.data.results || []).map(x => ({ thirdShopId: String(x.thirdShopId), shopName: x.shopName }));
}

async function 读队列(page, thirdShopId) {
  const r = await 页面内请求(page, `/api/copilot/v1/knowledge/chat-log-review/paginate?thirdShopId=${thirdShopId}&pageIndex=1&pageSize=200`, 'GET');
  if (r.httpStatus !== 200 || r.json?.code !== 1) throw new Error(`读审核队列失败 店=${thirdShopId} http=${r.httpStatus} code=${r.json?.code}`);
  return r.json.data?.results || [];
}

async function 读明细(page, id, thirdShopId) {
  const r = await 页面内请求(page, `/api/copilot/v1/knowledge/chat-log-review/detail?id=${id}&thirdShopId=${thirdShopId}`, 'GET');
  if (r.httpStatus !== 200 || r.json?.code !== 1) throw new Error(`读明细失败 id=${id} http=${r.httpStatus} code=${r.json?.code}`);
  return r.json.data;
}

function 摘要(d) {
  const kp = (d.knowledgePoints || [])[0] || {};
  const ks = (kp.knowledgeList || []).map(k => `[${k.source} active=${k.active}] ${String(k.content).replace(/\s+/g, ' ')}`).join(' ｜ ') || '(无知识)';
  const logs = d.chatLogs || [];
  const 买家 = logs.filter(x => x.personType === 3).map(x => String(x.content)).filter(x => !/^https?:|^\{/.test(x));
  const 时段 = logs.length ? `${logs[0].msgTime} ~ ${logs[logs.length - 1].msgTime}` : '';
  return { 商品: kp.productInfo ? String(kp.productInfo.title).slice(0, 40) : '无', 知识: ks, 买家问: 买家.slice(0, 4).map(x => x.slice(0, 30)).join(' / ').slice(0, 160), 时段 };
}

async function main() {
  const baseUrl = required('--base-url').replace(/\/$/, '');
  const profile = required('--profile');
  const outDir = argument('--out-dir', process.cwd());
  fs.mkdirSync(outDir, { recursive: true });

  const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || argument('--playwright-core-path') || 'playwright-core');
  const 启动 = { headless: true };
  const 频道 = argument('--browser-channel');
  if (频道) 启动.channel = 频道;
  const context = await chromium.launchPersistentContext(path.resolve(profile), 启动);
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    if (process.argv.includes('--list')) {
      let 店铺 = [];
      if (process.argv.includes('--all')) 店铺 = await 读店铺列表(page);
      else {
        const 指定 = (argument('--shops', '') || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!指定.length) throw new Error('--list 需要 --shops "id1,id2" 或 --all');
        店铺 = 指定.map(id => ({ thirdShopId: id, shopName: '' }));
      }
      const 结果 = [];
      for (const s of 店铺) {
        const rows = await 读队列(page, s.thirdShopId);
        const 待审 = rows.filter(r => r.approvalStatus === 1);
        console.log(`店 ${s.shopName || ''} ${s.thirdShopId}：队列 ${rows.length} 条，待审核 ${待审.length} 条`);
        for (const r of 待审) {
          const d = await 读明细(page, r.id, s.thirdShopId);
          const 简 = 摘要(d);
          结果.push({ thirdShopId: s.thirdShopId, id: r.id, ...简 });
          console.log(`  · ${r.id}｜${简.时段}｜${简.商品}`);
          console.log(`    买家问：${简.买家问}`);
          console.log(`    知识：${简.知识.slice(0, 220)}`);
        }
      }
      const 文件 = path.join(outDir, `调优坊待审-${Date.now()}.json`);
      fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), 待审: 结果 }, null, 1));
      console.log(`共待审核 ${结果.length} 条；证据：${文件}`);
      return;
    }

    if (process.argv.includes('--approve')) {
      const ids = (argument('--approve', '') || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!ids.length) throw new Error('--approve 需要 id 列表');
      const 提交 = process.argv.includes('--commit');
      console.log(`待标记 ${ids.length} 条${提交 ? '' : '（dry-run，加 --commit 才写）'}`);
      const 记录 = [];
      for (const id of ids) {
        if (!提交) { console.log(`  · ${id}`); continue; }
        const r = await 页面内请求(page, '/api/copilot/v1/knowledge/chat-log-review/approve', 'POST', { id });
        const ok = r.httpStatus === 200 && r.json?.code === 1;
        记录.push({ id, httpStatus: r.httpStatus, code: r.json?.code, 响应: r.json?.msg });
        console.log(`  ${ok ? '✓' : '✗'} ${id} ${r.json?.msg || ''}`);
      }
      if (提交) {
        const 文件 = path.join(outDir, `调优坊标记-${Date.now()}.json`);
        fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), 记录 }, null, 1));
        console.log(`证据：${文件}`);
      }
      return;
    }

    throw new Error('需要 --list 或 --approve');
  } finally {
    await context.close();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}

module.exports = { 摘要 };
