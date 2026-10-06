#!/usr/bin/env node
// R：只读——经 CDP(9339) 拉全库 + 目标卡详情（P1 7 张 + 待核 1 张 + P2 1 张），供反审 P1/P2 落地决策。
// 产出：R-写前全库.json、R-卡详情-写前.json、卡-<id>-before.json（每张一张）
'use strict';
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const CDP = 'http://localhost:9339';
const DIR = __dirname;
const IDS = [
  '6abe23359bb5d85e7b8b10af',
  '6abe23359bb5d85e7b8b10aa',
  '6abb4427908ac50ae9029a18',
  '6abb4404908ac50ae90299d6',
  '6ab9e9e14b0d3739f15c896d',
  '6ab9e9e14b0d3739f15c8975',
  '6abb4405908ac50ae9029a0c',
  '6a9a32665680f7693636d477',
  '6a9a3c38644e354d71a3f71c'
];

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.connectOverCDP(CDP);
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('agent.tanyuai.com'));
    if (!page) throw new Error('未找到 agent.tanyuai.com 页面');
    console.log(`CDP 页面：${page.url()}`);

    const r = await page.evaluate(async () => {
      const rr = await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 10000 }) });
      let j = null; try { j = await rr.json(); } catch { }
      return { http: rr.status, json: j };
    });
    if (r.http !== 200 || r.json?.code !== 1) throw new Error(`卡库拉取失败 http=${r.http} code=${r.json?.code}`);
    const rows = r.json.data?.results || [];
    if (rows.length < (r.json.data?.total || 0)) throw new Error(`全库未拉全：rows=${rows.length} < total=${r.json.data?.total}`);
    fs.writeFileSync(path.join(DIR, 'R-写前全库.json'), JSON.stringify({ 时间: new Date().toISOString(), 页面地址: page.url(), total: r.json.data?.total, rows }, null, 0), 'utf8');
    console.log(`全库 rows=${rows.length} total=${r.json.data?.total} → R-写前全库.json`);

    const details = [];
    const missing = [];
    for (const id of IDS) {
      const inList = rows.some(x => x.id === id);
      let d = null;
      try {
        d = await page.evaluate(async (cid) => {
          const rr = await fetch(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(cid)}`, { credentials: 'include' });
          let j = null; try { j = await rr.json(); } catch { }
          return { http: rr.status, json: j };
        }, id);
      } catch (e) { d = { http: 0, json: { code: 0, msg: String(e.message || e) } }; }
      if (d.http !== 200 || d.json?.code !== 1 || !d.json?.data?.id) {
        console.log(`缺卡：${id} 列表在库=${inList} detail http=${d.http} code=${d.json?.code} msg=${d.json?.msg || ''}`);
        missing.push({ id, inList, http: d.http, code: d.json?.code, msg: d.json?.msg || '', detail: d.json?.data || null });
        continue;
      }
      details.push(d.json.data);
      fs.writeFileSync(path.join(DIR, `卡-${id}-before.json`), JSON.stringify(d.json.data, null, 2), 'utf8');
    }
    fs.writeFileSync(path.join(DIR, 'R-缺卡.json'), JSON.stringify({ 时间: new Date().toISOString(), 缺卡: missing }, null, 1), 'utf8');
    const sum = details.map(c => ({
      id: c.id, title: c.title, type: c.type,
      ifBelievable: c.ifBelievable, ifOpen: c.ifOpen,
      orderStatus: c.orderStatus, labels: c.labels,
      绑店: (c.includeCondition || {}).shop || [],
      排除: ((c.excludeCondition || {}).shop || []),
      段数: (c.content || []).length,
      段结构: (c.content || []).map(x => x.type || '(no-type)'),
      正文: (c.content || []).map(x => String(x?.content ?? ''))
    }));
    fs.writeFileSync(path.join(DIR, 'R-卡详情-写前.json'), JSON.stringify({ 时间: new Date().toISOString(), 数量: sum.length, 缺卡: missing.map(x => x.id), 卡: sum }, null, 1), 'utf8');
    console.log(`\n拉全 ${sum.length}/${IDS.length} 张；缺卡 ${missing.length}: ${missing.map(x => x.id).join(', ')}`);
    for (const c of sum) {
      console.log(`\n========== ${c.id} [${c.type}] ${c.title} ==========`);
      console.log(`ifBelievable=${c.ifBelievable} ifOpen=${c.ifOpen} 绑店=${JSON.stringify(c.绑店)} 段数=${c.段数} 段结构=${JSON.stringify(c.段结构)}`);
      c.正文.forEach((t, i) => console.log(`--- 段[${i}] ---\n${t}`));
    }
  } finally { await browser.close().catch(() => { }); }
}

main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
