const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/b3460/.pi-edge-work/node_modules/playwright-core');

const BACKUP = 'D:/备份文件夹/探域问答审核-20260907-gift-policy';
const SHOP = '2095398963959042048';
const SNAP = JSON.parse(fs.readFileSync(path.join(BACKUP, 'before.json'), 'utf8'));
const body = c => (c.content || []).map(x => x.content || '').join('\n');
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const fields = ['id', 'title', 'content', 'labels', 'ifBelievable', 'type', 'ifOpen', 'includeCondition', 'excludeCondition', 'timeliness', 'cycleTimeliness', 'orderStatus', 'lastUpdatedAt'];
const payload = c => Object.fromEntries(fields.map(k => [k, k === 'content' ? (c.content || []).map(x => ({ content: x.content })) : c[k]]));

const GIFT = `【德达医疗拼多多旗舰店赠品活动】\n仅适用于德达医疗拼多多旗舰店订单，不适用于其他平台或其他店铺。详情页未限定型号时，本店各型号均按以下规则执行，C1也可参加。\n\n下单赠品：\n- 标配吸氧管1根。\n- 过滤器＋过滤棉1份。\n- 雾化版本指C1L，赠雾化套装1套；C1不带雾化，不赠雾化套装。\n- 吸氧面罩：前100名下单赠1个；客户咨询时可联系客服登记，未核对订单前不说已经登记或寄出。该活动没有限定型号。\n\n收货晒单赠品：\n收货后真实晒单，文字10字以上，联系客服登记；以下四选一，不叠加：42L氧气袋1个、血氧仪1个、鼻吸管1份、过滤器＋过滤棉1份。\n\n付邮领取：\n每3个月可领取终身吸氧管4根，邮费13元由买家承担；需提供本店订单，由客服核对领取记录。\n\n标配配件、下单赠品、晒单赠品和付邮领取活动分别核对，不把不同活动合并承诺。`;

const SERVICE = `亲亲～咱们售后服务政策如下：\n✅ 7天：无理由退货。\n✅ 30天内：不合适支持换款、质量问题包退。\n✅ 1年：整机享质保服务（配件耗材除外）。\n✅ 5年：压缩机5年质保。\n✅ 2年：充电便携制氧机整机2年质保（电池为耗材，1年质保）。\n✅ 退货包运费：平台承担退货运费。`;

function inTargetScope(c) {
  const shops = c.includeCondition?.shop || [];
  const spus = c.includeCondition?.spu || [];
  return shops.some(x => x.thirdShopId === SHOP) || spus.some(x => x.thirdShopId === SHOP);
}

function rewrite(c) {
  let s = body(c);
  const old = /拼多多德达医疗旗舰店晒单赠品为氧气袋、血氧仪、鼻吸管、过滤器四选一，只能选择一件，不叠加、不赠送组合套装。仅C1型号不参加，C1L及其他型号可参加。请告知选择的赠品并提供本店订单号，由我们核对登记；鼻吸管和过滤器需核对机型适配，具体规格不预先承诺。此规则不改变购买套餐中的标配清单。/g;
  s = s.replace(old, GIFT);
  s = s.replace(/以下赠品活动仅适用于拼多多德达医疗旗舰店购买的订单，不适用于其他平台或其他店铺。/g, '本店赠品活动仅适用于德达医疗拼多多旗舰店订单，不适用于其他平台或其他店铺。');
  s = s.replace(/本店仅C1型号不参加额外赠品活动，C1L及其他型号均支持参加/g, '详情页未限定型号时，本店各型号均可参加额外赠品活动，C1也可参加');
  s = s.replace(/仅C1型号不参加，C1L及其他型号可参加/g, '详情页未限定型号时，各型号均可参加，C1也可参加');
  s = s.replace(/C1仍不参加额外赠品活动/g, 'C1也可参加本店统一赠品活动');
  s = s.replace(/C1L及其他非C1型号可特殊备注/g, '各型号均可联系客服登记');
  s = s.replace(/本店符合活动条件的非C1制氧机订单（C1L可参加）/g, '本店各型号订单');
  s = s.replace(/具体规格不预先承诺/g, '鼻吸管为1份，过滤器＋过滤棉为1份');
  s = s.replace(/吸氧管：下单即送/g, '吸氧管：下单赠送1根');
  s = s.replace(/过滤器\+过滤棉：下单即送/g, '过滤器＋过滤棉：下单赠送1份');
  s = s.replace(/- 退货包运费：平台补贴 放心购/g, '- 退货包运费：平台承担退货运费');
  s = s.replace(/- 5年质保：核心部件压缩机/g, '- 5年质保：压缩机5年质保');
  s = s.replace(/✅ 5年：压缩机5年质保。?\s*$/m, '✅ 5年：压缩机5年质保。\n✅ 退货包运费：平台承担退货运费。');
  if (c.id === '6a9a61c34a45121da4d7d432' || c.id === '6a9a3c40644e354d71a3f882') {
    const q = (s.match(/^Q:[^\n]+/m) || ['Q:制氧机售后服务政策（质保）'])[0];
    s = `${q}\nA:${SERVICE}`;
  }
  if (s === body(c)) return null;
  return [{ content: s }];
}

(async () => {
  const plan = [];
  for (const c of SNAP.cards) {
    if (!c.ifOpen || !inTargetScope(c)) continue;
    const b = body(c);
    const relevant = /拼多多德达医疗旗舰店晒单赠品为|本店仅C1型号不参加|仅C1型号不参加|C1仍不参加额外赠品|本店符合活动条件的非C1|吸氧管：下单即送|过滤器\+过滤棉：下单即送|质保政策如下|退货包运费：平台补贴/.test(b);
    if (!relevant) continue;
    const after = rewrite(c);
    if (after) plan.push({ id: c.id, before: b, after: after[0].content, type: c.type, title: c.title, includeCondition: c.includeCondition });
  }
  fs.writeFileSync(path.join(BACKUP, 'plan.json'), JSON.stringify(plan, null, 2));
  if (!plan.length) throw Error('没有生成计划，停止');
  const ctx = await chromium.launchPersistentContext('C:/Users/b3460/.pi-edge-auto', { channel: 'msedge', headless: true });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://agent.tanyuai.com/v2/agent-builder/knowledge-base', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const req = (url, data) => page.evaluate(async ({ url, data }) => {
      const r = await fetch(url, { method: data ? 'POST' : 'GET', credentials: 'include', headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined });
      const j = await r.json(); if (!r.ok || j.code !== 1) throw Error(`${url} ${r.status} ${j.code} ${j.msg || ''}`); return j.data;
    }, { url, data });
    const detail = id => req(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(id)}`);
    const journal = { startedAt: new Date().toISOString(), planCount: plan.length, entries: [] };
    for (const x of plan) {
      const current = await detail(x.id);
      if (body(current) !== x.before) { journal.entries.push({ id: x.id, status: 'conflict-skipped' }); continue; }
      const next = { ...current, content: [{ content: x.after }] };
      const saved = await req('/api/kbe/v1/knowledge-card/update', payload(next));
      const reread = await detail(x.id);
      if (body(reread) !== x.after) throw Error(`回读正文不一致: ${x.id}`);
      if (stable(reread.includeCondition) !== stable(current.includeCondition) || reread.type !== current.type || reread.ifOpen !== current.ifOpen) throw Error(`范围/类型/启用状态变化: ${x.id}`);
      journal.entries.push({ id: x.id, status: 'applied', response: saved });
      fs.writeFileSync(path.join(BACKUP, 'execution-journal.json'), JSON.stringify(journal, null, 2));
    }
    fs.writeFileSync(path.join(BACKUP, 'execution-journal.json'), JSON.stringify(journal, null, 2));
    const bad = journal.entries.filter(x => x.status !== 'applied');
    console.log(JSON.stringify({ plan: plan.length, applied: journal.entries.filter(x => x.status === 'applied').length, exceptions: bad, backup: BACKUP }, null, 2));
    if (bad.length) process.exitCode = 1;
  } finally { await ctx.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
