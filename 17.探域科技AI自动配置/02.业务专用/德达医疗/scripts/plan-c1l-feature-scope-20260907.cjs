const fs = require('fs');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const BACKUP = 'D:/备份文件夹/探域问答审核-20260907-c1l-feature-scope';
const SPUS = new Set(['446872879403', '582414503778', '686392427262', '584301262287', '446929841571']);
const TAG = '（仅C1L款）';
const body = c => (c.content || []).map(x => x.content).join('\n');
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

function scopedLine(line) {
  if (line.includes('仅限C1L') || line.includes('仅限DH22-C1L') || line.includes('C1L款') || line.includes('C1L型号') || line.includes('C1L雾化款')) return line;
  let out = line;
  if (/(雾化)/.test(out)) {
    out = out.replace(/(制氧雾化一体机|制氧\+雾化功能|制氧\+雾化|支持雾化制氧一体|支持雾化功能设计|支持雾化|具备雾化功能设计|具备雾化功能|雾化功能|氧疗和雾化|雾化速率|雾化口|雾化套装限制|雾化套装)/, `$1${TAG}`);
    if (out === line && /(功能|优势|治疗|用药)/.test(out)) out = out.replace(/雾化/, `雾化${TAG}`);
  }
  if (/(遥控)/.test(out)) {
    out = out.replace(/(远程遥控操作|远程遥控|无线遥控操作|无线遥控|支持遥控操作|遥控操作|遥控功能|遥控器可启动|遥控器)/, `$1${TAG}`);
  }
  return out;
}

(async () => {
  fs.mkdirSync(BACKUP, { recursive: true });
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const req = (url, data) => page.evaluate(async ({ url, data }) => {
      const r = await fetch(url, { method: data ? 'POST' : 'GET', credentials: 'include', headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
      const j = await r.json(); if (!r.ok || j.code !== 1) throw Error(`${url} ${r.status} ${j.code} ${j.msg || ''}`); return j.data;
    }, { url, data });
    const cards = (await req('/api/kbe/v1/knowledge-card/page', { pageNo: 1, pageSize: 3000 })).results;
    if (!Array.isArray(cards) || cards.length < 1900 || new Set(cards.map(c => c.id)).size !== cards.length) throw Error('全量快照保护失败');
    fs.writeFileSync(`${BACKUP}/before.json`, JSON.stringify(cards, null, 2));
    const plan = [];
    for (const [index, c] of cards.entries()) {
      const spus = (c.includeCondition?.spu || []).map(x => x.spuId);
      if (!c.ifOpen || !spus.some(x => SPUS.has(x))) continue;
      const before = body(c);
      if (!before.includes('雾化') && !before.includes('遥控')) continue;
      const after = before.split('\n').map(scopedLine).join('\n');
      if (after !== before) plan.push({ index, id: c.id, type: c.type, title: c.title, before, after, includeCondition: c.includeCondition });
    }
    fs.writeFileSync(`${BACKUP}/plan.json`, JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({ snapshot: cards.length, candidates: plan.length, tag: TAG, backup: BACKUP }, null, 2));
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
