#!/usr/bin/env node
// V-终检：全库前后对比（CDP 9339 直查）——写前 R-写前全库.json vs 写后全库：
// 卡数、增/减 id、正文变化清单、目标卡业务字段、非目标业务变化（按可比字段）。
// 产出 V-终检-写后全库.json / V-终检.json / V-终检控制台.txt
'use strict';
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const CDP = 'http://localhost:9339';
const DIR = __dirname;
const IDS = ['6abe23359bb5d85e7b8b10af', '6abb4427908ac50ae9029a18', '6abb4404908ac50ae90299d6', '6ab9e9e14b0d3739f15c896d', '6abb4405908ac50ae9029a0c', '6a9a3c38644e354d71a3f71c'];
const BIZ = ['type', 'ifBelievable', 'ifOpen', 'orderStatus', 'labels', 'timeliness', 'cycleTimeliness', 'includeCondition', 'excludeCondition', 'title'];
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const contentOf = c => stable((c.content || []).map(x => String(x?.content ?? '')));
const bizOf = c => stable(BIZ.map(k => [k, c[k]]));

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.connectOverCDP(CDP);
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('agent.tanyuai.com'));
    if (!page) throw new Error('未找到 agent.tanyuai.com 页面');
    const r = await page.evaluate(async () => {
      const rr = await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 10000 }) });
      let j = null; try { j = await rr.json(); } catch { }
      return { http: rr.status, json: j };
    });
    if (r.http !== 200 || r.json?.code !== 1) throw new Error(`拉库失败 http=${r.http} code=${r.json?.code}`);
    const rows = r.json.data?.results || [];
    if (rows.length < (r.json.data?.total || 0)) throw new Error(`全库未拉全 rows=${rows.length} total=${r.json.data?.total}`);
    fs.writeFileSync(path.join(DIR, 'V-终检-写后全库.json'), JSON.stringify({ 时间: new Date().toISOString(), total: r.json.data?.total, rows }, null, 0), 'utf8');

    const before = JSON.parse(fs.readFileSync(path.join(DIR, 'R-写前全库.json'), 'utf8')).rows;
    const bm = new Map(before.map(x => [x.id, x]));
    const am = new Map(rows.map(x => [x.id, x]));
    const added = rows.filter(x => !bm.has(x.id)).map(x => ({ id: x.id, type: x.type, ifBelievable: x.ifBelievable, 文本: String((x.content || [])[0]?.content || '').slice(0, 60) }));
    const removed = before.filter(x => !am.has(x.id)).map(x => ({ id: x.id, type: x.type, ifBelievable: x.ifBelievable, 文本: String((x.content || [])[0]?.content || '').slice(0, 60) }));
    const contentChanged = [];
    const bizChanged = [];
    for (const [id, b] of bm) {
      const a = am.get(id);
      if (!a) continue;
      if (contentOf(b) !== contentOf(a)) contentChanged.push(id);
      if (bizOf(b) !== bizOf(a)) bizChanged.push(id);
    }
    const out = {
      时间: new Date().toISOString(),
      卡数: { 写前: before.length, 写后: rows.length },
      新增: added, 消失: removed,
      正文变化: contentChanged,
      正文变化_目标: contentChanged.filter(id => IDS.includes(id)),
      正文变化_非目标: contentChanged.filter(id => !IDS.includes(id)),
      业务字段变化: bizChanged,
      业务字段变化_目标: bizChanged.filter(id => IDS.includes(id)),
      业务字段变化_非目标: bizChanged.filter(id => !IDS.includes(id))
    };
    fs.writeFileSync(path.join(DIR, 'V-终检.json'), JSON.stringify(out, null, 1), 'utf8');
    console.log(JSON.stringify(out, null, 1));
  } finally { await browser.close().catch(() => { }); }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
