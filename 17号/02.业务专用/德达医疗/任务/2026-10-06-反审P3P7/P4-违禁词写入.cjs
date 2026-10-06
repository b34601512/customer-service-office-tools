#!/usr/bin/env node
// P4：把 9 个词**逐个**追加进 agent.prohibited.words 默认配置的 server 列（仅智能体发送拦截）。
// 默认 dry-run；--commit 才写。每加 1 词：写前重读比对 → save → 回读核对 → 落盘 journal。
// 失败即停、不重试。经 CDP(9339) 现有页面 fetch（不启动新浏览器、不动本体）。
'use strict';
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const CDP = 'http://localhost:9339';
const DIR = __dirname;
const META = 'agent.prohibited.words';
const WORDS = [
  '72小时', '1万小时', '顺丰空运', '次日达', '活动价', '买贵补差',
  '顺丰速发', '24小时速发', '今天买明天用'
];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const save = (n, o) => fs.writeFileSync(path.join(DIR, n), JSON.stringify(o, null, 1), 'utf8');

async function main() {
  const commit = process.argv.includes('--commit');
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.connectOverCDP(CDP);
  const journal = { 时间: new Date().toISOString(), commit, 词表: WORDS, 步骤: [] };
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('agent.tanyuai.com'));
    if (!page) throw new Error('未找到 agent.tanyuai.com 页面');
    const call = (endpoint, body) => page.evaluate(async ({ endpoint, body }) => {
      const r = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      let json = null; try { json = await r.json(); } catch { }
      return { httpStatus: r.status, json };
    }, { endpoint, body });

    const getItem = async () => {
      const r = await call('/api/shop-config/agent/config/get', { metaIds: [META] });
      if (r.httpStatus !== 200 || r.json?.code !== 1) throw new Error(`读配置失败 http=${r.httpStatus} code=${r.json?.code}`);
      const item = r.json?.data?.[META]?.item?.[0];
      if (!item) throw new Error('配置里没有默认配置条目');
      return item;
    };

    const before = await getItem();
    save('P4-违禁词-before.json', { 时间: new Date().toISOString(), item: before });
    console.log(`before：client=${(before.client || []).length} server=${(before.server || []).length}`);
    console.log(`server(before)=${JSON.stringify(before.server)}`);

    // 预检：待加词不得已在任一列表中
    for (const w of WORDS) {
      const dup = (before.client || []).includes(w) || (before.server || []).includes(w)
        || (before.clientWhitelist || []).includes(w) || (before.serverWhitelist || []).includes(w)
        || (before.clientReplacementWord || []).includes(w) || (before.serverReplacementWord || []).includes(w);
      if (dup) throw new Error(`词已在列表中：${w}（去重失败，停止）`);
    }
    console.log(`预检：9 词均不在现行列表，可追加。commit=${commit}`);

    if (!commit) {
      console.log('[dry-run] 未写入。核对后加 --commit 执行。');
      save('P4-违禁词-计划.json', { 时间: new Date().toISOString(), 通道: 'server（仅智能体发送拦截）', 追加: WORDS, beforeServer: before.server });
      return;
    }

    let current = before;
    for (let i = 0; i < WORDS.length; i++) {
      const w = WORDS[i];
      // 写前重读：防止并行会话修改
      const fresh = await getItem();
      if (!eq(fresh, current)) throw new Error(`写前重读与上一步不一致（第 ${i + 1} 词 ${w}），停止`);
      const target = { ...fresh, server: [...(fresh.server || []), w] };
      const payload = { configs: { [META]: { item: [target] } } };
      const res = await call('/api/shop-config/agent/config/save', payload);
      const step = { i: i + 1, word: w, saveHttp: res.httpStatus, saveCode: res.json?.code, saveSuccess: res.json?.success };
      if (!(res.httpStatus === 200 && res.json?.code === 1 && res.json?.success === true)) {
        step.status = 'save-failed'; journal.步骤.push(step); save('P4-违禁词-journal.json', journal);
        throw new Error(`第 ${i + 1} 词保存失败：${JSON.stringify(res)}`);
      }
      await page.waitForTimeout(1200);
      const after = await getItem();
      step.serverAfter = after.server;
      const okWord = eq(after.server, target.server);
      const okRest = eq(after.client, fresh.client) && eq(after.clientWhitelist, fresh.clientWhitelist)
        && eq(after.clientReplacementWord, fresh.clientReplacementWord)
        && eq(after.serverWhitelist, fresh.serverWhitelist) && eq(after.serverReplacementWord, fresh.serverReplacementWord)
        && after.name === fresh.name && after.ifDefault === fresh.ifDefault && eq(after.thirdShopIds, fresh.thirdShopIds);
      step.serverOk = okWord; step.restOk = okRest;
      step.status = okWord && okRest ? 'verified' : 'verify-failed';
      journal.步骤.push(step);
      save('P4-违禁词-journal.json', journal);
      console.log(`[${i + 1}/${WORDS.length}] ${w} → ${step.status} server=${(after.server || []).length} 词`);
      if (!okWord || !okRest) throw new Error(`第 ${i + 1} 词回读不一致，停止`);
      current = after;
    }

    save('P4-违禁词-after.json', { 时间: new Date().toISOString(), item: current });
    console.log(`✅ 全部完成：server ${(before.server || []).length} → ${(current.server || []).length} 词`);
    console.log(JSON.stringify(current.server));
  } finally {
    await browser.close().catch(() => { });
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
