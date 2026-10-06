#!/usr/bin/env node
// V-复读：独立复读（不经执行器）——CDP 9339 直查 6 张卡 detail，与写前快照比：
// ① 正文 == 任务 JSON 的 after；② 业务字段与写前全等；③ 绑店/排除/labels/type/开关原样。
// 产出 V-复读.json / V-复读控制台.txt
'use strict';
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const CDP = 'http://localhost:9339';
const DIR = __dirname;
const IDS = [
  '6abe23359bb5d85e7b8b10af',
  '6abb4427908ac50ae9029a18',
  '6abb4404908ac50ae90299d6',
  '6ab9e9e14b0d3739f15c896d',
  '6abb4405908ac50ae9029a0c',
  '6a9a3c38644e354d71a3f71c'
];
const FIELDS = ['id', 'title', 'content', 'labels', 'ifBelievable', 'type', 'ifOpen', 'includeCondition', 'excludeCondition', 'timeliness', 'cycleTimeliness', 'orderStatus', 'lastUpdatedAt'];
function businessMeta(card) {
  const out = {};
  for (const k of FIELDS) if (k !== 'content' && k !== 'lastUpdatedAt') out[k] = card[k];
  if (out.excludeCondition == null) out.excludeCondition = { spu: [], shop: [], rules: [], productGroupId: [], sellerGroup: [], platform: [] };
  if (out.excludeCondition && typeof out.excludeCondition === 'object') {
    for (const k of ['spu', 'shop', 'rules', 'productGroupId', 'sellerGroup', 'platform']) if (out.excludeCondition[k] == null) out.excludeCondition[k] = [];
  }
  return out;
}
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const segsOf = c => (c.content || []).map(x => String(x?.content ?? ''));

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.connectOverCDP(CDP);
  const result = { 时间: new Date().toISOString(), 卡: [] };
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('agent.tanyuai.com'));
    if (!page) throw new Error('未找到 agent.tanyuai.com 页面');
    for (const id of IDS) {
      const before = JSON.parse(fs.readFileSync(path.join(DIR, `卡-${id}-before.json`), 'utf8'));
      const task = JSON.parse(fs.readFileSync(path.join(DIR, `T-${id}.json`), 'utf8'));
      const after = task.items[0].after;
      const d = await page.evaluate(async (cid) => {
        const rr = await fetch(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(cid)}`, { credentials: 'include' });
        let j = null; try { j = await rr.json(); } catch { }
        return { http: rr.status, json: j };
      }, id);
      if (d.http !== 200 || d.json?.code !== 1 || !d.json?.data?.id) throw new Error(`detail 失败 ${id} http=${d.http} code=${d.json?.code}`);
      const afterCard = d.json.data;
      const now = segsOf(afterCard);
      const checks = {
        段数对: now.length === after.length,
        正文逐段对: stable(now) === stable(after),
        旧目标串已无: true,
        业务字段与写前全等: stable(businessMeta(afterCard)) === stable(businessMeta(before)),
        绑店原样: stable((afterCard.includeCondition || {}).shop) === stable((before.includeCondition || {}).shop),
        SPU原样: stable((afterCard.includeCondition || {}).spu) === stable((before.includeCondition || {}).spu),
        排除域原样: stable(afterCard.excludeCondition || {}) === stable(before.excludeCondition || {}),
        labels原样: stable(afterCard.labels) === stable(before.labels)
      };
      const entry = { id, type: afterCard.type, ifBelievable: afterCard.ifBelievable, ifOpen: afterCard.ifOpen, 段数: now.length, checks, PASS: Object.values(checks).every(Boolean), 正文: now };
      result.卡.push(entry);
      console.log(`${entry.PASS ? 'PASS' : 'FAIL'} ${id} 段数 ${now.length} 检查=${JSON.stringify(checks)}`);
    }
  } finally { await browser.close().catch(() => { }); }
  fs.writeFileSync(path.join(DIR, 'V-复读.json'), JSON.stringify(result, null, 1), 'utf8');
  const fail = result.卡.filter(x => !x.PASS);
  console.log(`\n总检 ${result.卡.length} 张：PASS ${result.卡.length - fail.length} / FAIL ${fail.length}`);
  if (fail.length) process.exitCode = 1;
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
