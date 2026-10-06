#!/usr/bin/env node
// T-构建：读 卡-<id>-before.json，按 P7 医疗/时效约束生成每卡任务 JSON（T-<id>.json）。
// 断言：目标串命中数恰为 1；改后与改前只差计划内容；业务字段（expected）原样锁定。
// 只读本地文件，不连网。
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const APPROVED_BY = '黎路遥 2026-10-06 18:55 批准 P3–P7（P7 医疗/时效边界卡改写）';

function load(id) { return JSON.parse(fs.readFileSync(path.join(DIR, `卡-${id}-before.json`), 'utf8')); }
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
    console.log(`[段${i}] 变化：\n  before: ${JSON.stringify(b.slice(0, 500))}\n  after : ${JSON.stringify(a.slice(0, 500))}`);
  }
  console.log(`→ T-${id}.json`);
}

// ---------- P7-1：6ac0d595e1041c390582eafa（京东仓「一般次日达」补「以实际物流为准」） ----------
{
  const id = '6ac0d595e1041c390582eafa';
  const c = segs(load(id));
  const after = [...c];
  after[0] = replaceOnce(after[0], '一般是【次日达】，快的话当天都有可能收到', '一般是【次日达】（具体以实际物流为准），快的话当天都有可能收到', 'P7-1 seg0');
  writeTask(id, 'P7-1：京东仓「一般次日达」补「（具体以实际物流为准）」（反审 P7；物流不承诺时效口径）；其余原样保留', c, after);
}

// ---------- P7-2：6a9a3c47644e354d71a3f9b5（吸入浓度/公式；补血氧判断禁令） ----------
{
  const id = '6a9a3c47644e354d71a3f9b5';
  const c = segs(load(id));
  const after = [...c];
  after[0] = replaceOnce(after[0],
    '不能用固定换算表或简易公式准确推算个人吸入浓度。请按照医生规定的供氧方式和流量选用设备，不能因混入空气就判断某一档位一定安全。',
    '不能用固定换算表或简易公式准确推算个人吸入浓度，也不能据此判断您的血氧是否正常。请按照医生规定的供氧方式和流量使用设备；用氧以医生要求为准，不要因混入空气就判断某一档位一定安全。',
    'P7-2 seg0');
  writeTask(id, 'P7-2：补「不能据此判断血氧是否正常」+「用氧以医生要求为准」（10-06 风格【医疗约束】：不得按血氧读数判断）；原防公式/防档位句保留', c, after);
}

// ---------- P7-3：6a9a3c474a45121da4d7c7c9（慢阻肺吸氧时长数字 → 交医生） ----------
{
  const id = '6a9a3c474a45121da4d7c7c9';
  const c = segs(load(id));
  const after = [...c];
  const oldA = 'A:您好亲亲～慢阻肺患者的吸氧时间因人而异哦～  \n轻中度患者一般可采用间歇吸氧，比如每次30分钟左右、间隔1～2小时再吸；  \n但重度或二型呼吸衰竭患者，多数需要每天持续吸氧数小时甚至更久，  \n具体吸氧时间和频率应根据血氧饱和度和医生建议来调整。  \n\n建议使用血氧仪监测，保持血氧在90%-93%之间最安全有效，  \n并严格遵循医生的指导哈～😊  ';
  const newA = 'A:您好亲亲～慢阻肺患者的吸氧时长、流量和频次需要由医生根据具体病情制定，不同情况差异很大，我们无法给出统一建议哦～  \n请严格按照医生要求的时长和流量使用，并定期复诊调整；如需使用血氧仪，监测结果也请交给医生判断，用氧以医生要求为准哈～😊';
  after[0] = replaceOnce(after[0], oldA, newA, 'P7-3 seg0');
  writeTask(id, 'P7-3：删「每次30分钟/间隔1～2小时/血氧90%-93%」等时长频次与目标值建议（10-06 风格【医疗约束】：不给吸氧时长、频次建议；不得按血氧读数判断）→ 统一交医生制定', c, after);
}

// ---------- P7-4：6a9a3c49644e354d71a3fa27（血氧 95% 目标值 → 交医生） ----------
{
  const id = '6a9a3c49644e354d71a3fa27';
  const c = segs(load(id));
  const after = [...c];
  const oldA = 'A:亲，您这个问题很专业哦，其实日常吸氧不是越高浓度越好～\n\n我们吸氧的目标是让血氧饱和度维持在95%以上（慢阻肺除外），就像喝水，喝饱了就行，不一定非要喝几升水～\n\n如果吸氧浓度过高，反而有氧中毒风险，所以机器输出的浓度是经过科学设计的，既能补充所需，也更安全哦～';
  const newA = 'A:亲，您这个问题很专业哦，其实日常吸氧不是越高浓度越好～具体需要多大流量、用多长时间，要由医生根据个人情况来定，不能按血氧读数自行判断哦～\n\n如果吸氧浓度过高，反而有氧中毒风险；机器输出的浓度是经过设计的，按医生要求的流量使用就好～用氧以医生要求为准，先咨询医生更稳妥哈～😊';
  after[0] = replaceOnce(after[0], oldA, newA, 'P7-4 seg0');
  writeTask(id, 'P7-4：删「血氧饱和度维持在95%以上」目标值（10-06 风格【医疗约束】：不得按血氧读数判断）→ 保留「不是越高越好/氧中毒风险」通用提示 + 交医生', c, after);
}

// ---------- P7-5：6a9a3c49644e354d71a3fa2a（低浓度公式 → 去公式、交医生） ----------
{
  const id = '6a9a3c49644e354d71a3fa2a';
  const c = segs(load(id));
  const after = [...c];
  const oldA = 'A:亲亲～吸氧浓度是有对应公式计算的哈🧮\n\n计算公式是：FiO₂(%) ≈ 21% + 4 × 氧流量(L/min)  \n也就是说，每升氧气大约能提升4%的吸氧浓度～\n注意：这里的氧流量是指出氧浓度能达90%以上的流量档位。\n\n比如您调节氧气流量到 【2升/分钟（出氧浓度≥90%）】，  \n那吸氧浓度大约是：21% + 4×2 = 【29%】\n\nFiO₂就是我们说的吸入气体中氧气浓度哦～  ';
  const newA = 'A:亲亲～人体实际吸入的氧浓度受供氧接口、呼吸状态等多种因素影响，不能靠固定公式准确推算，我们也不便按公式帮您计算哦～\n\n请以医生规定的供氧方式和流量为准使用设备，不要按公式或档位自行判断吸氧浓度是否合适；如果对用量有疑问，建议先咨询医生哈～😊';
  after[0] = replaceOnce(after[0], oldA, newA, 'P7-5 seg0');
  writeTask(id, 'P7-5：删 FiO₂ 计算公式与算例（与 6a9a3c47644e354d71a3f9b5「不能用公式推算」冲突；10-06 风格【医疗约束】不给档位建议）→ 交医生', c, after);
}

console.log('\n全部任务文件构建完成。');
