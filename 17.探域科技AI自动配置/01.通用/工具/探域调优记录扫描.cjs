#!/usr/bin/env node
// 意图：探域「调优记录」（调优工坊）日常巡检工具——增量扫描待处理记录 + 标记已处理。
// 背景：黎路遥 2026-10-03 拍板：调优记录是**日常任务**，每次醒来都看、范围最近 30 天。
//       接口与原因字典见 `01.通用/平台适配/探域/调优记录日常任务与接口.md`。
//
// 用法：
//   node 探域调优记录扫描.cjs --base-url "https://agent.tanyuai.com" --profile "<画像>" \
//     --playwright-core-path "<playwright-core>" --browser-channel msedge \
//     --scan [--since "2026-10-03 17:00:00"] [--until "…"] [--shops "id1,id2" | --all] \
//     [--actionable-only] [--out-dir "<证据目录>"]
//   node 探域调优记录扫描.cjs ... --review "id1,id2" [--commit] [--shop <thirdShopId>]
//
// 说明：--scan 只读；--review 默认 dry-run，加 --commit 才写（一次一条；写后回读 reviewStatus 必须=2）。
//       增量建议：每轮只拉上次检查之后的时间窗（如最近 10~30 分钟），历史积压另按窗口分批。
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
function 现在() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function 页面内(page, endpoint, method, body) {
  return page.evaluate(async ({ endpoint, method, body }) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
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
  const r = await 页面内(page, '/api/copilot/product-learning/config/page?pageIndex=1&pageSize=100', 'GET');
  if (r.httpStatus !== 200 || r.json?.code !== 1) throw new Error(`读店铺列表失败 http=${r.httpStatus}`);
  return (r.json.data.results || []).map(x => ({ thirdShopId: String(x.thirdShopId), shopName: x.shopName }));
}

async function 读原因字典(page) {
  const r = await 页面内(page, '/api/im/agent-trace/no-send-reason-list', 'GET');
  const 表 = new Map();
  for (const x of r.json?.data || []) 表.set(Number(x.value), x.label);
  return 表;
}

async function 拉记录(page, thirdShopId, beginTime, endTime, pageSize = 5000) {
  const r = await 页面内(page, '/api/im/agent-trace/paginateV2', 'POST', { thirdShopId, pageIndex: 1, pageSize, beginTime, endTime });
  if (r.httpStatus !== 200 || r.json?.code !== 1) throw new Error(`拉记录失败 店=${thirdShopId} http=${r.httpStatus} code=${r.json?.code}`);
  return r.json.data?.results || [];
}

async function 读明细(page, id, thirdShopId) {
  const r = await 页面内(page, '/api/im/agent-trace/trace', 'POST', { cardId: id, thirdShopId });
  if (r.httpStatus !== 200 || r.json?.code !== 1) throw new Error(`读明细失败 id=${id} http=${r.httpStatus} code=${r.json?.code}`);
  return r.json.data || {};
}

async function main() {
  const baseUrl = required('--base-url').replace(/\/$/, '');
  const profile = required('--profile');
  const outDir = argument('--out-dir', process.cwd());
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

    if (process.argv.includes('--review')) {
      const ids = (argument('--review', '') || '').split(',').map(s => s.trim()).filter(Boolean);
      const 提交 = process.argv.includes('--commit');
      const 单店 = argument('--shop');
      if (!ids.length) throw new Error('--review 需要 id 列表');
      if (提交 && !单店) throw new Error('--review --commit 需要 --shop <thirdShopId>（标记要带店铺）');
      console.log(`待标记 ${ids.length} 条${提交 ? '' : '（dry-run，加 --commit 才写）'}`);
      const 记录 = [];
      for (const id of ids) {
        if (!提交) { console.log(`  · ${id}`); continue; }
        const w = await 页面内(page, '/api/im/agent-trace/review', 'POST', { cardId: id, thirdShopId: 单店 });
        const ok = w.httpStatus === 200 && w.json?.code === 1;
        const 回读 = await 读记录状态(page, id, 单店);
        记录.push({ id, 写响应: w.json?.msg, 回读reviewStatus: 回读 });
        console.log(`  ${ok && String(回读) === '2' ? '✓' : '✗'} ${id} 写=${w.json?.msg || ''} 回读=${回读}`);
      }
      if (提交) {
        fs.mkdirSync(outDir, { recursive: true });
        const f = path.join(outDir, `调优记录标记-${Date.now()}.json`);
        fs.writeFileSync(f, JSON.stringify({ 时间: new Date().toISOString(), 记录 }, null, 1));
        console.log('证据：' + f);
      }
      return;
    }

    if (!process.argv.includes('--scan')) throw new Error('需要 --scan 或 --review');
    const 字典 = await 读原因字典(page);
    let 店铺 = [];
    if (process.argv.includes('--all')) 店铺 = await 读店铺列表(page);
    else {
      const 指定 = (argument('--shops', '') || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!指定.length) throw new Error('--scan 需要 --shops "id1,id2" 或 --all');
      店铺 = 指定.map(id => ({ thirdShopId: id, shopName: '' }));
    }
    const beginTime = argument('--since', '2026-10-03 00:00:00');
    const endTime = argument('--until', 现在());
    const 只列要动的 = process.argv.includes('--actionable-only');
    const 结果 = [];
    for (const s of 店铺) {
      const 全部 = await 拉记录(page, s.thirdShopId, beginTime, endTime);
      const 待处理 = 全部.filter(x => String(x.reviewStatus) === '1');
      const 未发送 = 待处理.filter(x => x.ifSend === false);
      console.log(`${s.shopName || s.thirdShopId}：窗口 ${beginTime} ~ ${endTime} 共 ${全部.length} 条，待处理 ${待处理.length}，未发送 ${未发送.length}`);
      for (const x of 未发送) {
        const d = await 读明细(page, x.id, s.thirdShopId);
        const 原因 = 字典.get(Number(d.noSendReason)) || d.noSendReasonName || String(d.noSendReason ?? '(空)');
        const 行 = { thirdShopId: s.thirdShopId, id: x.id, time: x.time, 原因, 有答: !!String(x.content || '').trim(), 问: String(x.question || '').slice(0, 60), 召回卡: (d.snapShots || []).map(y => String(y.title || '').slice(0, 24)) };
        结果.push(行);
        if (!只列要动的 || /话术未生成/.test(原因)) console.log(`  · ${x.time}｜${原因}｜${行.问}`);
      }
    }
    fs.mkdirSync(outDir, { recursive: true });
    const f = path.join(outDir, `调优记录扫描-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify({ 窗口: { beginTime, endTime }, 明细: 结果 }, null, 1));
    const 计数 = 结果.reduce((m, x) => (m[x.原因] = (m[x.原因] || 0) + 1, m), {});
    console.log('未发送原因分布：' + JSON.stringify(计数));
    console.log(`共 ${结果.length} 条；证据：${f}`);
  } finally {
    await context.close();
  }
}

/** 标记后回读该条 reviewStatus（用列表按 id 过滤，避免再猜接口）。 */
async function 读记录状态(page, id, thirdShopId) {
  for (let i = 0; i < 3; i++) {
    const rows = await 拉记录(page, thirdShopId, '2000-01-01 00:00:00', 现在());
    const 命中 = rows.find(x => String(x.id) === String(id));
    if (命中) return 命中.reviewStatus;
    await new Promise(r => setTimeout(r, 2000));
  }
  return '(回读未找到)';
}

if (require.main === module) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
