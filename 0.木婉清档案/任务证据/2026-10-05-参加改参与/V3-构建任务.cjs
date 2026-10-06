#!/usr/bin/env node
// V3：只读——经 CDP(9339) 拉全库，为「26 张卡 参加→参与」任务构建执行器任务 JSON。
// 产出：V3-写前全库.json（写前基线，供终检比对）
//       V3-目标清单.json（26 张 id/现状/漂移标记，供复读/终检比对）
//       V3-改法-任务.json（check/apply/verify 共用：before=当前正文，after=逐 part 替换「参加」→「参与」）
// 漂移规则：某卡正文与 改法表-原始.json 不一致（或「参加」处数不符）→ 该卡停止、其余继续，控制台与目标清单写清。
'use strict';
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const CDP = 'http://localhost:9339';
const DIR = __dirname;
const NOTE = '参加改参与（2026-10-05 黎路遥选 A：26 张全改）：仅把正文里每个「参加」替换为「参与」（66 处，含「不参加」→「不参与」），其余一字不动；ifBelievable/标题/绑店/ifOpen/orderStatus 一律不动。';
const APPROVED_BY = '黎路遥（副经理；2026-10-05 12:44「A：26张全改」）';

function partsOf(card) { return (card.content || []).map(x => String(x?.content ?? '')); }
function countOf(text, word) { return text.split(word).length - 1; }

async function main() {
  const 原始 = JSON.parse(fs.readFileSync(path.join(DIR, '改法表-原始.json'), 'utf8'));
  if (!Array.isArray(原始) || !原始.length) throw new Error('改法表-原始.json 为空');
  console.log(`证据表 ${原始.length} 张；应有「参加」${原始.reduce((s, e) => s + e.n, 0)} 处`);

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
    fs.writeFileSync(path.join(DIR, 'V3-写前全库.json'), JSON.stringify({ 时间: new Date().toISOString(), 页面地址: page.url(), total: r.json.data?.total, rows }, null, 0), 'utf8');
    const 表 = new Map(rows.map(x => [String(x.id), x]));
    console.log(`rows=${rows.length} total=${r.json.data?.total}`);

    const 缺卡 = [], 漂移 = [], 状态观察 = [], 目标 = [], items = [];
    let 纳入处数 = 0;
    for (const e of 原始) {
      const id = String(e.id);
      const c = 表.get(id);
      if (!c) { 缺卡.push(id); console.log(`缺卡：${id}`); continue; }
      const 原part = e.content_parts.map(p => String(p.content ?? ''));
      const 现part = partsOf(c);
      const 原文 = 原part.join('\n'), 现文 = 现part.join('\n');
      const 原处 = countOf(原文, '参加'), 现处 = countOf(现文, '参加');
      const 正文同 = JSON.stringify(现part) === JSON.stringify(原part);
      if (!正文同 || 现处 !== 原处 || 现处 !== e.n) {
        漂移.push({ id, 正文同, 证据处数: e.n, 证据处数实测: 原处, 现处数: 现处 });
        console.log(`漂移，跳过：${id} 正文同=${正文同} 证据处数=${e.n}/${原处} 现处=${现处}`);
        目标.push({ id, type: c.type, ifBelievable: c.ifBelievable, 标题: c.title || null, ifOpen: c.ifOpen, 处数: 现处, 漂移: true, 说明: `正文与证据不一致（正文同=${正文同}，证据处=${原处}，现处=${现处}）` });
        continue;
      }
      if (e.type !== c.type || e.ifBelievable !== c.ifBelievable) {
        状态观察.push({ id, 证据type: e.type, 现type: c.type, 证据可信: e.ifBelievable, 现可信: c.ifBelievable });
        console.log(`状态观察（不阻断）：${id} type ${e.type}→${c.type} ifBelievable ${e.ifBelievable}→${c.ifBelievable}`);
      }
      const after = 现part.map(t => t.split('参加').join('参与'));
      const 残留 = countOf(after.join('\n'), '参加');
      const 新增 = countOf(after.join('\n'), '参与') - countOf(现文, '参与');
      if (残留 !== 0 || 新增 !== 现处) throw new Error(`${id} 替换自检失败：残留参加=${残留} 新增参与=${新增} 处数=${现处}`);
      items.push({
        id,
        note: NOTE,
        before: 现part,
        after,
        expected: { title: c.title ?? null, type: c.type, ifBelievable: c.ifBelievable ?? null, ifOpen: c.ifOpen ?? null }
      });
      纳入处数 += 现处;
      目标.push({ id, type: c.type, ifBelievable: c.ifBelievable, 标题: c.title || null, ifOpen: c.ifOpen, labels: c.labels || [], 处数: 现处, 换后参与校验: { 残留: 残留, 新增: 新增 } });
      console.log(`纳入：${id} [${c.type}] 处数=${现处} parts=${现part.length}`);
    }

    const 跳过 = 漂移.length + 缺卡.length;
    const 头部 = { company: '德达医疗', scope: '探域知识卡-仅正文「参加」→「参与」', note: NOTE, approvedBy: APPROVED_BY };
    fs.writeFileSync(path.join(DIR, 'V3-改法-任务.json'), JSON.stringify({ ...头部, items }, null, 1), 'utf8');
    fs.writeFileSync(path.join(DIR, 'V3-目标清单.json'), JSON.stringify({
      时间: new Date().toISOString(), 数量: 原始.length, 纳入: items.length, 跳过: 跳过,
      应有处数: 原始.reduce((s, e) => s + e.n, 0), 纳入处数, 缺卡, 漂移, 状态观察, 目标
    }, null, 1), 'utf8');

    console.log(`—— 构建完成：纳入 ${items.length}/${原始.length} 张、${纳入处数} 处；跳过 ${跳过}（漂移 ${漂移.length}、缺卡 ${缺卡.length}）；状态观察 ${状态观察.length}`);
    console.log('→ V3-写前全库.json / V3-目标清单.json / V3-改法-任务.json');
    if (跳过) { console.log('⚠ 有卡被跳过，回执必须写清：' + JSON.stringify({ 缺失: 缺卡, 漂移 })); }
  } finally { await browser.close().catch(() => { }); }
}

main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
