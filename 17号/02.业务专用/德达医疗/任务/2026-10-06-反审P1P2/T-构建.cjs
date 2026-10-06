#!/usr/bin/env node
// T-构建：读 R-卡详情-写前.json + 各卡 before 快照，按 P1/P2 改法生成每卡任务 JSON（T-<id>.json）。
// 断言：目标串命中数恰为预期；改后与改前只差计划内容；业务字段（expected）原样锁定。
// 只读本地文件，不连网。
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const APPROVED_BY = '黎路遥 2026-10-06 批准 P1（P2 同批）';

function load(id) {
  return JSON.parse(fs.readFileSync(path.join(DIR, `卡-${id}-before.json`), 'utf8'));
}
function segs(card) { return (card.content || []).map(x => String(x.content)); }
function count(hay, needle) { return hay.split(needle).length - 1; }
function replaceOnce(s, from, to, tag) {
  const n = count(s, from);
  if (n !== 1) throw new Error(`${tag}：目标串命中 ${n} 次（要求 1 次）`);
  return s.replace(from, to);
}
function expectedOf(card) {
  return { type: card.type, ifBelievable: card.ifBelievable, ifOpen: card.ifOpen, orderStatus: card.orderStatus, labels: card.labels };
}
function writeTask(id, note, before, after) {
  if (after.length === before.length && before.every((s, i) => s === after[i])) throw new Error(`${id}：after 与 before 无差异`);
  const card = load(id);
  const task = {
    company: '德达医疗（8店探域）',
    scope: note,
    note,
    approvedBy: APPROVED_BY,
    items: [{ id, note, before, after, expected: expectedOf(card) }]
  };
  fs.writeFileSync(path.join(DIR, `T-${id}.json`), JSON.stringify(task, null, 1), 'utf8');
  console.log(`\n########## ${id} ##########`);
  console.log('note:', note);
  console.log(`段数 before=${before.length} after=${after.length}`);
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const b = before[i] ?? '(无)', a = after[i] ?? '(无)';
    if (b === a) { console.log(`[段${i}] 不变（${String(b).length}字）`); continue; }
    console.log(`[段${i}] 变化：\n  before: ${JSON.stringify(b.slice(0, 400))}\n  after : ${JSON.stringify(a.slice(0, 400))}`);
  }
  console.log(`→ T-${id}.json`);
}

// ---------- P1-1：6abe23359bb5d85e7b8b10af ----------
{
  const id = '6abe23359bb5d85e7b8b10af';
  const c = segs(load(id));
  const after = [...c];
  after[1] = replaceOnce(after[1], '（1台顶4台）', '', 'P1-1 seg1');
  after[2] = replaceOnce(after[2], '；顺丰24小时速发（以实际物流为准）。', '；物流：顺丰发货，具体以实际物流为准。', 'P1-1 seg2');
  writeTask(id, 'P1-1：去「1台顶4台」夸大词（124口径#4）；「顺丰24小时速发」改「物流：顺丰发货，具体以实际物流为准」（124口径#2）；保价句（10-06 12:42 已批准）原样保留', c, after);
}

// ---------- P1-2：6abb4427908ac50ae9029a18 ----------
{
  const id = '6abb4427908ac50ae9029a18';
  const c = segs(load(id));
  const after = [...c];
  const n1 = count(after[0], '（整机1年质保） 顺丰速发<br>');
  if (n1 !== 5) throw new Error(`P1-2：规格名「顺丰速发」命中 ${n1} 次（要求 5）`);
  if (count(after[0], '顺丰速发') !== 5) throw new Error('P1-2：seg0 顺丰速发 总命中不为 5，需人工看');
  after[0] = after[0].split('（整机1年质保） 顺丰速发<br>').join('（整机1年质保）<br>');
  writeTask(id, 'P1-2：规格表 5 行规格名去掉「顺丰速发」时效承诺（124口径#2）；「顺丰发货/365天持续供氧/医院同款」等按 10-04 复核记录与 124 口径内保留', c, after);
}

// ---------- P1-3：6abb4404908ac50ae90299d6 ----------
{
  const id = '6abb4404908ac50ae90299d6';
  const c = segs(load(id));
  if (!c[2] || !c[2].startsWith('【退换货、质保、维修特别说明】')) throw new Error('P1-3：段2 不是退换货段，停止');
  const after = [c[0], c[1], c[3]];
  writeTask(id, 'P1-3：删「退换货、质保、维修特别说明」整段——售后政策统一走标准卡 6ac107c0…（124口径#1）；原「拆封非质量不退」句现行卡已不在；注意事项/安全提示段保留', c, after);
}

// ---------- P1-4：6ab9e9e14b0d3739f15c896d ----------
{
  const id = '6ab9e9e14b0d3739f15c896d';
  const c = segs(load(id));
  const after = [...c];
  after[0] = replaceOnce(after[0], '采用顺丰速发物流。', '采用顺丰物流，具体以实际物流为准。', 'P1-4 seg0');
  writeTask(id, 'P1-4：去「顺丰速发」时效承诺→「顺丰物流，具体以实际物流为准」（124口径#2）；保价句（10-06 12:42 已批准）原样保留', c, after);
}

// ---------- P1-5：6abb4405908ac50ae9029a0c ----------
{
  const id = '6abb4405908ac50ae9029a0c';
  const c = segs(load(id));
  const after = [...c];
  after[2] = replaceOnce(after[2], '顺丰发货，全国联保', '顺丰发货（具体以实际物流为准），全国联保', 'P1-5 seg2');
  after[3] = replaceOnce(after[3], '（雾化套装仅限雾化版赠送）', '（雾化套装仅限雾化版赠送；具体以店铺当次活动为准，请咨询客服核实）', 'P1-5 seg3');
  writeTask(id, 'P1-5：物流句补「以实际物流为准」；礼包句补「以店铺当次活动为准/客服核实」（124口径#2；赠品核实口径）；「365天持续供氧」按124口径#6照实保留', c, after);
}

// ---------- P2：6a9a3c38644e354d71a3f71c ----------
{
  const id = '6a9a3c38644e354d71a3f71c';
  const c = segs(load(id));
  const after = [...c];
  after[0] = replaceOnce(after[0], '晒单还送实用氧气袋🎁，支持7天免费试用哦～性价比真的超高！\n', '', 'P2 seg0');
  writeTask(id, 'P2：删「晒单还送实用氧气袋🎁，支持7天免费试用哦～性价比真的超高！」一句；下方赠品公告（四选一/核实句）保留', c, after);
}

console.log('\n全部任务 JSON 已生成。');
