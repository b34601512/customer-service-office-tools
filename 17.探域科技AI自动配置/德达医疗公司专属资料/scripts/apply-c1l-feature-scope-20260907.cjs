const fs = require('fs');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');
const B = 'D:/备份文件夹/探域问答审核-20260907-c1l-feature-scope';
const plan = JSON.parse(fs.readFileSync(`${B}/plan.json`, 'utf8'));
const body = c => (c.content || []).map(x => x.content).join('\n');
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const fields = ['id', 'title', 'content', 'labels', 'ifBelievable', 'type', 'ifOpen', 'includeCondition', 'excludeCondition', 'timeliness', 'cycleTimeliness', 'orderStatus', 'lastUpdatedAt'];
const payload = c => Object.fromEntries(fields.map(k => [k, k === 'content' ? (c.content || []).map(x => ({ content: x.content })) : c[k]]));

(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const req = (url, data) => page.evaluate(async ({ url, data }) => {
      const r = await fetch(url, { method: data ? 'POST' : 'GET', credentials: 'include', headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
      const j = await r.json(); if (!r.ok || j.code !== 1) throw Error(`${url} ${r.status} ${j.code} ${j.msg || ''}`); return j.data;
    }, { url, data });
    const detail = id => req(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(id)}`);
    const write = c => req('/api/kbe/v1/knowledge-card/update', payload(c));
    const journal = { startedAt: new Date().toISOString(), planCount: plan.length, entries: [] };
    let cursor = 0;
    async function worker() {
      while (cursor < plan.length) {
        const x = plan[cursor++];
        try {
          const c = await detail(x.id);
          if (body(c) !== x.before) { journal.entries.push({ id: x.id, index: x.index, status: 'conflict-skipped' }); continue; }
          const next = { ...c, content: [{ content: x.after }] };
          await write(next);
          const saved = await detail(x.id);
          if (body(saved) !== x.after) throw Error('回读正文不一致');
          if (stable(saved.includeCondition) !== stable(c.includeCondition) || saved.type !== c.type || saved.ifOpen !== c.ifOpen) throw Error('范围/类型/启用状态变化');
          journal.entries.push({ id: x.id, index: x.index, status: 'applied' });
        } catch (e) { journal.entries.push({ id: x.id, index: x.index, status: 'error', error: e.message }); }
        fs.writeFileSync(`${B}/execution-journal.json`, JSON.stringify(journal, null, 2));
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    const errors = journal.entries.filter(x => x.status !== 'applied');
    fs.writeFileSync(`${B}/execution-journal.json`, JSON.stringify(journal, null, 2));
    console.log(JSON.stringify({ plan: plan.length, applied: plan.length - errors.length, exceptions: errors }, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
