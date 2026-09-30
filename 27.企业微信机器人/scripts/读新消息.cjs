#!/usr/bin/env node
// 读企微新消息（值守用，根治「漏读」）—— 一个动作：按 **上一条已处理的消息 id** 往后读，不漏不重。
//
// 为什么不用 offset：offset 是字节数，某轮只要打印少了一点、offset 却推进了，中间几条就被跳过
//（2026-09-30 实测漏过用户 3 条消息）。改成记 msgid：文件是追加写的，找到上次那条之后的全打印。
//
// 用法：
//   node scripts/读新消息.cjs              → 打印所有新消息（并推进 .state/inbox.last-msgid）
//   node scripts/读新消息.cjs --不回写      → 只看，不推进（排查用）
//   node scripts/读新消息.cjs --最近 12     → 打印最近 12 条（不推进，排查用）
const fs = require('fs');
const path = require('path');

const 根 = path.resolve(__dirname, '..');
const 收件箱 = path.join(根, '.state', 'inbox.jsonl');
const 游标 = path.join(根, '.state', 'inbox.last-msgid');
const argv = process.argv.slice(2);
const 不回写 = argv.includes('--不回写');
const 最近位置 = argv.indexOf('--最近');
const 最近 = 最近位置 > -1 ? Number(argv[最近位置 + 1]) || 0 : 0;

if (!fs.existsSync(收件箱)) { console.log('（还没有收件箱文件）'); process.exit(0); }
const 全部 = fs.readFileSync(收件箱, 'utf8').trim().split('\n').filter(Boolean).map((行) => {
  try { return JSON.parse(行); } catch (e) { return null; }
}).filter(Boolean);

let 待打印 = [];
if (最近 > 0) {
  待打印 = 全部.slice(-最近);
} else {
  const 上次 = fs.existsSync(游标) ? fs.readFileSync(游标, 'utf8').trim() : '';
  let 起点 = 0;
  if (上次) {
    const 位置 = 全部.findIndex((m) => String(m.msgid) === 上次);
    起点 = 位置 > -1 ? 位置 + 1 : Math.max(0, 全部.length - 20); // 找不到就退回最近 20 条，宁多不漏
  } else {
    起点 = Math.max(0, 全部.length - 20);
  }
  待打印 = 全部.slice(起点);
}

if (待打印.length === 0) { console.log('新消息 0 条'); process.exit(0); }
console.log(`新消息 ${待打印.length} 条：`);
for (const j of 待打印) {
  const 谁 = j.chattype === 'group' ? `【群 ${String(j.chatid || '').slice(0, 10)}】` : '【单聊】';
  const 我 = String(j.fromUserId || '').startsWith('wo**********************') ? '（黎路遥）' : '';
  console.log(`[${j.at}] ${谁}${我}${j.note ? '(' + j.note + ')' : ''} ${j.kind}: ${String(j.text || '').slice(0, 300)}`);
}
if (!不回写 && 最近 === 0) {
  const 最后 = 待打印[待打印.length - 1];
  fs.writeFileSync(游标, String(最后.msgid || ''), 'utf8');
  console.log('（游标已推进到最后一条；先打印、后处理，安全）');
}
