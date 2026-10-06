#!/usr/bin/env node
// V：独立复读（CDP 直读 5 张卡）+ 全库终检（与 R0-全库.json 对比：目标/非目标/新增/消失）。
'use strict';
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const CDP = 'http://localhost:9339';
const DIR = __dirname;
const IDS = ['6ac0d595e1041c390582eafa', '6a9a3c47644e354d71a3f9b5', '6a9a3c474a45121da4d7c7c9', '6a9a3c49644e354d71a3fa27', '6a9a3c49644e354d71a3fa2a'];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function segs(card) { return (card.content || []).map(x => String(x?.content ?? '')); }
function metaOf(card) {
  const keys = ['type', 'ifBelievable', 'ifOpen', 'orderStatus', 'labels', 'includeCondition', 'excludeCondition', 'timeliness', 'cycleTimeliness', 'title'];
  const o = {}; for (const k of keys) o[k] = card[k] ?? null; return o;
}

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.connectOverCDP(CDP);
  const log = []; const say = s => { log.push(s); console.log(s); };
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('agent.tanyuai.com'));
    if (!page) throw new Error('未找到 agent.tanyuai.com 页面');

    // 1) 独立复读 5 张卡
    const 复读 = { 时间: new Date().toISOString(), 卡: [] };
    for (const id of IDS) {
      const d = await page.evaluate(async (cid) => {
        const rr = await fetch(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(cid)}`, { credentials: 'include' });
        let j = null; try { j = await rr.json(); } catch { }
        return { http: rr.status, json: j };
      }, id);
      const card = d.json?.data;
      const task = JSON.parse(fs.readFileSync(path.join(DIR, `T-${id}.json`), 'utf8'));
      const before = JSON.parse(fs.readFileSync(path.join(DIR, `卡-${id}-before.json`), 'utf8'));
      const contentOk = eq(segs(card), task.items[0].after);
      const metaOk = eq(metaOf(card), metaOf(before));
      fs.writeFileSync(path.join(DIR, `V-卡-${id}-after.json`), JSON.stringify(card, null, 2), 'utf8');
      复读.卡.push({ id, contentOk, metaOk, 段数: (card.content || []).length, 正文: segs(card) });
      say(`V-复读 ${id}: contentOk=${contentOk} metaOk=${metaOk}`);
    }
    fs.writeFileSync(path.join(DIR, 'V-复读.json'), JSON.stringify(复读, null, 1), 'utf8');

    // 2) 全库终检
    const r = await page.evaluate(async () => {
      const rr = await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 10000 }) });
      let j = null; try { j = await rr.json(); } catch { }
      return { http: rr.status, json: j };
    });
    if (r.http !== 200 || r.json?.code !== 1) throw new Error(`全库拉取失败 http=${r.http}`);
    const afterRows = r.json.data?.results || [];
    if (afterRows.length < (r.json.data?.total || 0)) throw new Error(`全库未拉全：rows=${afterRows.length} < total=${r.json.data?.total}`);
    fs.writeFileSync(path.join(DIR, 'V-终检-全库.json'), JSON.stringify({ 时间: new Date().toISOString(), total: r.json.data?.total, rows: afterRows }, null, 0), 'utf8');
    const beforeRows = JSON.parse(fs.readFileSync(path.join(DIR, 'R0-全库.json'), 'utf8')).rows;
    say(`全库：before ${beforeRows.length} → after ${afterRows.length}`);

    const beforeById = new Map(beforeRows.map(x => [x.id, x]));
    const afterById = new Map(afterRows.map(x => [x.id, x]));
    const newIds = afterRows.filter(x => !beforeById.has(x.id)).map(x => x.id);
    const goneIds = beforeRows.filter(x => !afterById.has(x.id)).map(x => x.id);
    const targetSet = new Set(IDS);
    const contentChanged = [], metaChanged = [];
    for (const [id, b] of beforeById) {
      const a = afterById.get(id); if (!a) continue;
      if (!eq(segs(b), segs(a))) contentChanged.push(id);
      if (!eq(metaOf(b), metaOf(a))) metaChanged.push(id);
    }
    const 终检 = {
      时间: new Date().toISOString(),
      库量: { before: beforeRows.length, after: afterRows.length },
      新增: newIds, 消失: goneIds,
      正文变化: contentChanged, 正文变化_目标: contentChanged.filter(x => targetSet.has(x)), 正文变化_非目标: contentChanged.filter(x => !targetSet.has(x)),
      业务字段变化: metaChanged, 业务字段变化_目标: metaChanged.filter(x => targetSet.has(x)), 业务字段变化_非目标: metaChanged.filter(x => !targetSet.has(x)),
      目标5张内容是否等于计划: IDS.map(id => ({ id, ok: eq(segs(afterById.get(id)), JSON.parse(fs.readFileSync(path.join(DIR, `T-${id}.json`), 'utf8')).items[0].after) }))
    };
    fs.writeFileSync(path.join(DIR, 'V-终检.json'), JSON.stringify(终检, null, 1), 'utf8');
    say(`新增 ${newIds.length}：${JSON.stringify(newIds)}`);
    say(`消失 ${goneIds.length}：${JSON.stringify(goneIds)}`);
    say(`正文变化 ${contentChanged.length}（目标 ${终检.正文变化_目标.length} / 非目标 ${终检.正文变化_非目标.length}）：非目标=${JSON.stringify(终检.正文变化_非目标)}`);
    say(`业务字段变化 ${metaChanged.length}（目标 ${终检.业务字段变化_目标.length} / 非目标 ${终检.业务字段变化_非目标.length}）：非目标=${JSON.stringify(终检.业务字段变化_非目标)}`);
    say(`目标5张=计划: ${JSON.stringify(终检.目标5张内容是否等于计划)}`);
  } finally {
    await browser.close().catch(() => { });
    fs.writeFileSync(path.join(DIR, 'V-控制台.txt'), log.join('\n') + '\n', 'utf8');
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
