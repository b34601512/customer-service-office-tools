#!/usr/bin/env node
// V4：只读终检——经 CDP(9339) 重拉全库，与 V3-写前全库.json（写前基线）比对：
//   期望：变化卡 = 任务纳入的 26 张（正文恰好换成 after、业务字段不变）；非目标变化 = 0；
//         新卡 0、消失 0；excludeCondition 的平台归一化差异单独列出、不计入违规。
'use strict';
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const CDP = 'http://localhost:9339';
const DIR = __dirname;
const segs = c => (c.content || []).map(x => String(x?.content ?? '')).join('\n');
function normScope(v) {
  const out = { ...(v || {}) };
  for (const k of ['spu', 'shop', 'rules', 'productGroupId', 'sellerGroup', 'platform']) if (out[k] == null) out[k] = [];
  return out;
}
function 关键(c) {
  return {
    title: c.title ?? null, type: c.type, labels: c.labels || [], ifBelievable: c.ifBelievable ?? null,
    ifOpen: c.ifOpen ?? null, includeCondition: normScope(c.includeCondition), orderStatus: c.orderStatus || [],
    timeliness: c.timeliness ?? null, cycleTimeliness: c.cycleTimeliness ?? null
  };
}

async function main() {
  const 旧 = JSON.parse(fs.readFileSync(path.join(DIR, 'V3-写前全库.json'), 'utf8'));
  const 任务 = JSON.parse(fs.readFileSync(path.join(DIR, 'V3-改法-任务.json'), 'utf8'));
  const 期望表 = new Map(任务.items.map(x => [String(x.id), x.after.join('\n')]));
  const 旧表 = new Map(旧.rows.map(x => [String(x.id), x]));

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
    if (r.http !== 200 || r.json?.code !== 1) throw new Error(`卡库拉取失败 http=${r.http} code=${r.json?.code}`);
    const 新rows = r.json.data?.results || [];
    const 新表 = new Map(新rows.map(x => [String(x.id), x]));

    const 目标变化 = [], 目标未变 = [], 目标异常 = [], 非目标变化 = [], 新卡 = [], 消失 = [], 排除域差异 = [], 排除域实质变化 = [];
    for (const [id, n] of 新表) {
      const o = 旧表.get(id);
      if (!o) { 新卡.push(id); continue; }
      const 内容变 = segs(o) !== segs(n);
      const 关键变 = JSON.stringify(关键(o)) !== JSON.stringify(关键(n));
      const 期望 = 期望表.get(id);
      const 归一化排除同 = JSON.stringify(normScope(o.excludeCondition)) === JSON.stringify(normScope(n.excludeCondition));
      const 原样排除同 = JSON.stringify(o.excludeCondition || {}) === JSON.stringify(n.excludeCondition || {});
      if (!原样排除同) 排除域差异.push({ id, 是目标: 期望 != null, before: o.excludeCondition ?? null, after: n.excludeCondition ?? null });
      if (!归一化排除同) 排除域实质变化.push({ id, 是目标: 期望 != null, before: o.excludeCondition ?? null, after: n.excludeCondition ?? null });

      if (期望 != null) {
        if (!内容变 && !关键变) 目标未变.push(id);
        else if (内容变 && !关键变 && 归一化排除同 && segs(n) === 期望) 目标变化.push({ id, 内容已换: true });
        else 目标异常.push({ id, 内容变, 关键变, 归一化排除同, 正文等于期望: segs(n) === 期望, before: 关键(o), after: 关键(n) });
      } else if (内容变 || 关键变 || !归一化排除同) {
        非目标变化.push({ id, 内容变, 关键变, 归一化排除同, before: { content: segs(o).slice(0, 40), ...关键(o) }, after: { content: segs(n).slice(0, 40), ...关键(n) } });
      }
    }
    for (const id of 旧表.keys()) if (!新表.has(id)) 消失.push(id);

    const 通过 = 目标变化.length === 任务.items.length && 目标未变.length === 0 && 目标异常.length === 0 &&
      非目标变化.length === 0 && 新卡.length === 0 && 消失.length === 0 && 排除域实质变化.length === 0;
    const out = {
      时间: new Date().toISOString(), 基线: 'V3-写前全库.json',
      旧库: { total: 旧.total, rows: 旧.rows.length }, 新库: { total: r.json.data?.total, rows: 新rows.length },
      期望变化卡数: 任务.items.length, 目标变化数: 目标变化.length, 目标未变数: 目标未变.length, 目标异常数: 目标异常.length,
      非目标变化数: 非目标变化.length, 新卡数: 新卡.length, 消失数: 消失.length,
      排除域归一化差异数: 排除域差异.length, 排除域实质变化数: 排除域实质变化.length, 通过,
      目标变化, 目标未变, 目标异常, 非目标变化, 新卡, 消失, 排除域差异, 排除域实质变化
    };
    fs.writeFileSync(path.join(DIR, 'V4-终检.json'), JSON.stringify(out, null, 1), 'utf8');
    console.log(`基线 V3（rows=${旧.rows.length} total=${旧.total}） → 现在 rows=${新rows.length} total=${r.json.data?.total}`);
    console.log(`变化卡 ${目标变化.length}/${任务.items.length}；目标未变 ${目标未变.length}；目标异常 ${目标异常.length}；非目标变化 ${非目标变化.length}；新卡 ${新卡.length}；消失 ${消失.length}；排除域归一化差异 ${排除域差异.length}（实质变化 ${排除域实质变化.length}）`);
    if (目标未变.length) console.log('目标未变：' + 目标未变.join(','));
    if (目标异常.length) console.log('目标异常：' + JSON.stringify(目标异常));
    if (非目标变化.length) console.log('非目标变化：' + JSON.stringify(非目标变化));
    if (排除域实质变化.length) console.log('排除域实质变化：' + JSON.stringify(排除域实质变化));
    console.log(`终检：${通过 ? '通过' : '未通过'}`);
    if (!通过) throw new Error('终检未通过');
    console.log('→ V4-终检.json');
  } finally { await browser.close().catch(() => { }); }
}

main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
