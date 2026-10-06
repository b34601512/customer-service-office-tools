#!/usr/bin/env node
// G-核销：反审 P3–P7 推进后核销清单条目（0.木婉清档案/探域反审清单.json）。
// 规则（按任务书 + 本次实际落地）：
//   ① P7 条目（6 条）→ 已处理（根因：P7-<卡id>（2026-10-06 改写））；
//   ② 「待主管」且状态含 P4、答复命中本轮 116 server 新增 9 词之一 → 已处理（根因：P4-违禁词补词）；
//   ③ P5 站外 5 条 → 已处理（根因：P5-站外口径复核（机器上客服为限；二维码/扫码由 116 client 词拦截））；
//   ④ P5 价格/活动 10 条 → 留「待主管」并更新理由（活动价/买贵补差已入词；具体价格数字需生成层，方案已出等拍板）；
//   ⑤ P6 2 条 → 留「待主管」并更新理由（清单已出；本记录为价格数字，属 P5 生成层）；
//   ⑥ 其余（P3 活动卡 16 条等）不动。
// 默认 dry-run；--commit 才写。写前快照 + 写后逐条 diff。
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const 清单路径 = 'D:/桌面/办公软件/0.木婉清档案/探域反审清单.json';
const WORDS = ['72小时', '1万小时', '顺丰空运', '次日达', '活动价', '买贵补差', '顺丰速发', '24小时速发', '今天买明天用'];
const 清单 = JSON.parse(fs.readFileSync(清单路径, 'utf8'));
const snapshot = JSON.parse(JSON.stringify(清单));

const P7_MAP = {
  '6ac0d595e1041c390582eafa': '已处理（根因：P7-6ac0d595e1041c390582eafa（京东仓补「以实际物流为准」；2026-10-06））',
  '6a9a3c47644e354d71a3f9b5': '已处理（根因：P7-6a9a3c47644e354d71a3f9b5（补「不能据此判断血氧」+用氧以医生为准；2026-10-06））',
  '6a9a3c49644e354d71a3fa27': '已处理（根因：P7-6a9a3c49644e354d71a3fa27（去「血氧95%以上」目标值；2026-10-06））'
};
const P5_站外新 = '已处理（根因：P5-站外口径复核（配件口径=机器上客服为限；「二维码/扫码」由 116 client 词拦截））';
const P5_价格新 = '待主管（P5：活动价/买贵补差已入 116 server 词；本记录为具体价格数字，需生成层（风格 494/500 已满，方案已出等拍板））';
const P6_新 = '待主管（P6 清单已出：价格/议价卡族现版已合规（价格以订单结算为准）；本记录为价格数字泄漏，属 P5 生成层，等拍板）';

const 改动 = [];
for (const it of 清单.items) {
  const 前 = it.状态 || '';
  const 答 = String(it.答 || '');
  const 卡 = (it.根因 || {}).卡 || '';
  let 后 = null;
  if (P7_MAP[卡] && 前.startsWith('待主管') && /P7/.test(前)) 后 = P7_MAP[卡];
  else if (前.startsWith('待主管') && /P4/.test(前)) {
    const hit = WORDS.filter(w => 答.includes(w));
    if (hit.length) 后 = `已处理（根因：P4-违禁词补词（116 server：${hit.join('、')}；2026-10-06））`;
  } else if (前.startsWith('待主管') && /P5 生成层措辞/.test(前)) 后 = P5_站外新;
  else if (前.startsWith('待主管') && /P5 生成层：价格\/活动不说/.test(前)) 后 = P5_价格新;
  else if (前.startsWith('待主管') && /P6/.test(前)) 后 = P6_新;
  if (后 && 后 !== 前) { 改动.push({ 序号: 清单.items.indexOf(it), id: it.id, 卡, 前, 后 }); it.状态 = 后; }
}

// 重算进度
const 计数 = {}; const 桶计数 = {};
for (const it of 清单.items) {
  const k = String(it.状态 || '').replace(/（.*$/s, '');
  const bucket = it.桶 || '(无)';
  计数[k] = (计数[k] || 0) + 1;
  桶计数[bucket] = 桶计数[bucket] || {};
  桶计数[bucket][k] = (桶计数[bucket][k] || 0) + 1;
}
清单.处理进度 = { 已处理: 计数['已处理'] || 0, 待主管: 计数['待主管'] || 0, 存疑: 计数['存疑'] || 0, 无需处理: 计数['无需处理'] || 0 };
清单.按桶进度 = 桶计数;
清单.更新 = new Date().toISOString();

const commit = process.argv.includes('--commit');
console.log(JSON.stringify({ commit, 改动条数: 改动.length, 处理进度: 清单.处理进度 }, null, 1));
for (const c of 改动) console.log(`#${c.序号} [${c.id}] 卡=${c.卡}\n  前: ${c.前}\n  后: ${c.后}`);

if (!commit) { console.log('[dry-run] 未写入。核对后加 --commit 执行。'); process.exit(0); }

// 写前快照 + 写后逐条 diff（只允许 状态/处理进度/按桶进度/更新 变化）
fs.writeFileSync(path.join(DIR, 'G-清单-写前快照.json'), JSON.stringify(snapshot, null, 1), 'utf8');
fs.writeFileSync(清单路径, JSON.stringify(清单, null, 1), 'utf8');
const after = JSON.parse(fs.readFileSync(清单路径, 'utf8'));
const diffs = [];
for (let i = 0; i < snapshot.items.length; i++) {
  const a = snapshot.items[i], b = after.items[i];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ 序号: i, id: a.id, 字段: k });
  }
}
const 非状态字段 = diffs.filter(d => d.字段 !== '状态');
console.log(`写后 diff：字段差异 ${diffs.length} 处（非状态字段 ${非状态字段.length} 处）`);
if (非状态字段.length) { console.log(JSON.stringify(非状态字段.slice(0, 20))); process.exitCode = 1; }
fs.writeFileSync(path.join(DIR, 'G-核销-diff.json'), JSON.stringify({ 改动, diffs }, null, 1), 'utf8');
console.log('✅ 核销完成');
