#!/usr/bin/env node
// V5：只读复读——经 CDP(9339) 逐张直查 26 张目标卡 detail，与写前基线 V3-写前全库.json / 任务 after 比对：
//   要求：正文 == 任务 after；「参加」出现 0 次；「参与」新增数 == 原处数；
//         ifBelievable/标题/type/labels/ifOpen/includeCondition/orderStatus 与写前一致。
'use strict';
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT = 'D:/桌面/办公软件/23.进店咨询导航问答优化/node_modules/playwright-core';
const CDP = 'http://localhost:9339';
const DIR = __dirname;
const segs = c => (c.content || []).map(x => String(x?.content ?? ''));
const cnt = (t, w) => t.split(w).length - 1;
function normExcl(v) {
  const out = { ...(v || {}) };
  for (const k of ['spu', 'shop', 'rules', 'productGroupId', 'sellerGroup', 'platform']) if (out[k] == null) out[k] = [];
  return out;
}

async function main() {
  const 旧 = JSON.parse(fs.readFileSync(path.join(DIR, 'V3-写前全库.json'), 'utf8'));
  const 任务 = JSON.parse(fs.readFileSync(path.join(DIR, 'V3-改法-任务.json'), 'utf8'));
  const 旧表 = new Map(旧.rows.map(x => [String(x.id), x]));

  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.connectOverCDP(CDP);
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('agent.tanyuai.com'));
    if (!page) throw new Error('未找到 agent.tanyuai.com 页面');
    const 详情 = {}, 结果 = [];
    for (const item of 任务.items) {
      const id = String(item.id);
      const r = await page.evaluate(async (cardId) => {
        const rr = await fetch(`/api/kbe/v1/knowledge-card/detail?id=${encodeURIComponent(cardId)}`, { credentials: 'include' });
        let j = null; try { j = await rr.json(); } catch { }
        return { http: rr.status, json: j };
      }, id);
      if (r.http !== 200 || r.json?.code !== 1) throw new Error(`${id} detail 拉取失败 http=${r.http} code=${r.json?.code}`);
      const n = r.json.data;
      详情[id] = n;
      const o = 旧表.get(id);
      const 前文 = segs(o).join('\n'), 后文 = segs(n).join('\n');
      const 原处 = cnt(前文, '参加'), 原参与 = cnt(前文, '参与');
      const 检查 = {
        正文同_after: JSON.stringify(segs(n)) === JSON.stringify(item.after),
        参加出现0次: cnt(后文, '参加') === 0,
        参与新增等于原处数: cnt(后文, '参与') - 原参与 === 原处,
        可信同: (n.ifBelievable ?? null) === (o.ifBelievable ?? null),
        标题同: (n.title ?? null) === (o.title ?? null),
        类型同: n.type === o.type,
        标签同: JSON.stringify(n.labels || []) === JSON.stringify(o.labels || []),
        开关同: (n.ifOpen ?? null) === (o.ifOpen ?? null),
        绑店同: JSON.stringify(n.includeCondition || {}) === JSON.stringify(o.includeCondition || {}),
        阶段同: JSON.stringify(n.orderStatus || []) === JSON.stringify(o.orderStatus || [])
      };
      const 排除域原样同 = JSON.stringify(n.excludeCondition || {}) === JSON.stringify(o.excludeCondition || {});
      const 排除域归一化同 = JSON.stringify(normExcl(n.excludeCondition)) === JSON.stringify(normExcl(o.excludeCondition));
      const 通过 = Object.values(检查).every(Boolean) && 排除域归一化同;
      结果.push({
        id, 通过, 原处数: 原处, 现参与数: cnt(后文, '参与'), 检查,
        排除域原样同, 排除域归一化同,
        段元数据: (n.content || []).map(x => ({ id: x.id, index: x.index, chunkLearnStatus: x.chunkLearnStatus }))
      });
      console.log(`${通过 ? 'PASS' : 'FAIL'} ${id} 处数=${原处} 参与=${cnt(后文, '参与')} 正文同=${检查.正文同_after} 参加0=${检查.参加出现0次} 可信同=${检查.可信同} 排除域归一化=${排除域归一化同}${排除域原样同 ? '' : '（原样不同=平台归一化）'}`);
    }
    const 通过数 = 结果.filter(x => x.通过).length;
    fs.writeFileSync(path.join(DIR, 'V5-复读-detail.json'), JSON.stringify({ 时间: new Date().toISOString(), 页数: 结果.length, 详情: 详情 }, null, 1), 'utf8');
    fs.writeFileSync(path.join(DIR, 'V5-复读.json'), JSON.stringify({ 时间: new Date().toISOString(), 数量: 结果.length, 通过: 通过数, 结果 }, null, 1), 'utf8');
    console.log(`复读：${通过数}/${结果.length} 通过`);
    if (通过数 !== 结果.length) throw new Error('复读有未通过项');
    console.log('→ V5-复读.json / V5-复读-detail.json');
  } finally { await browser.close().catch(() => { }); }
}

main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
