#!/usr/bin/env node
// R0：只读——经 CDP(9339) 拉全库 + P7/P3 目标卡详情 + 违禁词配置 + 风格列表。
// 产出：R0-全库.json、卡-<id>-before.json、R0-违禁词.json、R0-风格.json、R0-控制台.txt
'use strict';
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const CDP = 'http://localhost:9339';
const DIR = __dirname;

const P7_IDS = [
  '6ac0d595e1041c390582eafa',
  '6a9a3c47644e354d71a3f9b5',
  '6a9a3c474a45121da4d7c7c9',
  '6a9a3c49644e354d71a3fa27',
  '6a9a3c49644e354d71a3fa2a'
];
const P3_IDS = [
  '6abb71abe4bec54754824a42',
  '6ac38522e4bec54754834d1b',
  '6ac3857ae1041c3905831e16',
  '6ac38582e4bec54754834d23',
  '6ac38589e4bec54754834d2c',
  '6ac38590e1041c3905831e1c',
  '6ac38598e4bec54754834d34'
];
const IDS = [...P7_IDS, ...P3_IDS];

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.connectOverCDP(CDP);
  const log = [];
  const say = (s) => { log.push(s); console.log(s); };
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('agent.tanyuai.com'));
    if (!page) throw new Error('未找到 agent.tanyuai.com 页面');
    say(`CDP 页面：${page.url()}`);

    // 1) 全库
    const r = await page.evaluate(async () => {
      const rr = await fetch('/api/kbe/v1/knowledge-card/page', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageNo: 1, pageSize: 10000 }) });
      let j = null; try { j = await rr.json(); } catch { }
      return { http: rr.status, json: j };
    });
    if (r.http !== 200 || r.json?.code !== 1) throw new Error(`卡库拉取失败 http=${r.http} code=${r.json?.code}`);
    const rows = r.json.data?.results || [];
    if (rows.length < (r.json.data?.total || 0)) throw new Error(`全库未拉全：rows=${rows.length} < total=${r.json.data?.total}`);
    fs.writeFileSync(path.join(DIR, 'R0-全库.json'), JSON.stringify({ 时间: new Date().toISOString(), 页面地址: page.url(), total: r.json.data?.total, rows }, null, 0), 'utf8');
    say(`全库 rows=${rows.length} total=${r.json.data?.total} → R0-全库.json`);

    // 2) 目标卡详情
    for (const id of IDS) {
      let d = null;
      try {
        d = await page.evaluate(async (cid) => {
          const rr = await fetch(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(cid)}`, { credentials: 'include' });
          let j = null; try { j = await rr.json(); } catch { }
          return { http: rr.status, json: j };
        }, id);
      } catch (e) { d = { http: 0, json: { code: 0, msg: String(e.message || e) } }; }
      if (d.http !== 200 || d.json?.code !== 1 || !d.json?.data?.id) {
        say(`缺卡：${id} http=${d.http} code=${d.json?.code} msg=${d.json?.msg || ''}`);
        fs.writeFileSync(path.join(DIR, `缺卡-${id}.json`), JSON.stringify(d.json || {}, null, 1), 'utf8');
        continue;
      }
      fs.writeFileSync(path.join(DIR, `卡-${id}-before.json`), JSON.stringify(d.json.data, null, 2), 'utf8');
      say(`卡 OK：${id} type=${d.json.data.type} 段数=${(d.json.data.content || []).length} title=${String(d.json.data.title || '').slice(0, 50)}`);
    }

    // 3) 违禁词配置
    const cfg = await page.evaluate(async () => {
      const rr = await fetch('/api/shop-config/agent/config/get', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metaIds: ['agent.prohibited.words'] }) });
      let j = null; try { j = await rr.json(); } catch { }
      return { http: rr.status, json: j };
    });
    fs.writeFileSync(path.join(DIR, 'R0-违禁词.json'), JSON.stringify(cfg, null, 1), 'utf8');
    const item = cfg.json?.data?.['agent.prohibited.words']?.item?.[0] || {};
    say(`违禁词：client=${(item.client || []).length} server=${(item.server || []).length} 白名单 client=${(item.clientWhitelist || []).length}/server=${(item.serverWhitelist || []).length}`);

    // 4) 风格列表
    const sty = await page.evaluate(async () => {
      const rr = await fetch('/api/shop-config/customer-style/list', { credentials: 'include' });
      let j = null; try { j = await rr.json(); } catch { }
      return { http: rr.status, json: j };
    });
    fs.writeFileSync(path.join(DIR, 'R0-风格.json'), JSON.stringify(sty, null, 1), 'utf8');
    const styles = sty.json?.data?.customerStyleDetailList || [];
    for (const s of styles) {
      say(`风格：${s.id} 「${s.styleName}」 setting=${String(s.setting || '').length}字 example=${String(s.example || '').length}字 绑定=${(s.toServices || []).length}`);
    }
  } finally {
    await browser.close().catch(() => { });
    fs.writeFileSync(path.join(DIR, 'R0-控制台.txt'), log.join('\n') + '\n', 'utf8');
  }
}

main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
