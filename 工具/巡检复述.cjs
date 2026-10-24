#!/usr/bin/env node
// 巡检员每日工作 · 每工作日 8:00 复述给黎路遥（黎路遥 2026-10-24 定）
//
// 为什么做成脚本而不是每次让模型现编：正文只有一份（0.木婉清档案/日常流程/巡检员每日工作-复述.md），
// 节假日判断也只有一处（D:/硅基公司/共享/节假日/<年>.json），模型每天只需要跑这一条命令。
//
// 用法：
//   node 工具/巡检复述.cjs            预览（不发，打印今天判成什么、要不要发）
//   node 工具/巡检复述.cjs --发        真发（只在工作日发）
//   node 工具/巡检复述.cjs --日期 2026-10-26 --干   指定日期预览（测节假日/调休用）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const 家 = path.join(__dirname, '..');
const 稿 = path.join(家, '0.木婉清档案', '日常流程', '巡检员每日工作-复述.md');
const 节假目录 = 'D:/硅基公司/共享/节假日';
const 企微 = path.join(家, '工具', '企微');

const 参数 = process.argv.slice(2);
const 要发 = 参数.includes('--发');
const 日期参数 = 参数.includes('--日期') ? 参数[参数.indexOf('--日期') + 1] : '';

function 今天() {
  if (日期参数) return 日期参数;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function 判工作日(日) {
  const 年 = 日.slice(0, 4);
  const 文件 = path.join(节假目录, `${年}.json`);
  let 数据 = null;
  try {
    数据 = JSON.parse(fs.readFileSync(文件, 'utf8'));
  } catch {
    return { 工作日: false, 理由: `读不到节假日表（${文件}）——按「不确定就不发」处理，别猜` };
  }
  const 放 = new Set((数据.holidays || []).map((x) => (typeof x === 'string' ? x : x.date)));
  const 班 = new Set((数据.workdays || []).map((x) => (typeof x === 'string' ? x : x.date)));
  const 周 = new Date(日 + 'T00:00:00').getDay(); // 0=周日
  if (放.has(日)) return { 工作日: false, 理由: `${日} 是法定节假日（${年}.json holidays）` };
  if (班.has(日)) return { 工作日: true, 理由: `${日} 是调休上班日（${年}.json workdays）` };
  if (周 === 0 || 周 === 6) return { 工作日: false, 理由: `${日} 是周${周 === 0 ? '日' : '六'}，且不在调休上班表里` };
  return { 工作日: true, 理由: `${日} 是周${'日一二三四五六'[周]}（普通工作日）` };
}

function 取正文() {
  const 全文 = fs.readFileSync(稿, 'utf8');
  const 段 = 全文.split(/^## 正文.*$/m)[1] || '';
  const 正文 = 段.replace(/^[>\s]*/, '').trim();
  if (!正文) throw new Error('复述稿里没找到「## 正文」段：' + 稿);
  return 正文;
}

const 日 = 今天();
const 判 = 判工作日(日);
console.log(`[日期] ${日}　[判断] ${判.工作日 ? '工作日' : '不发'}　（${判.理由}）`);

if (!判.工作日) {
  console.log('[结果] 今天不发复述（节假日/周末），静默。');
  process.exit(0);
}

const 正文 = 取正文();
console.log(`[正文] ${正文.length} 字，取自 ${path.relative(家, 稿)}`);

if (!要发) {
  console.log('[结果] 预览模式，没发。要发加 --发');
  process.exit(0);
}

const 临时 = path.join(企微, `_复述-${process.pid}.txt`);
fs.writeFileSync(临时, 正文, 'utf8');
try {
  const 出 = execFileSync(process.execPath, ['直连.mjs', '--to', '2', '--file', 临时, '--send'], {
    cwd: 企微,
    encoding: 'utf8',
  });
  console.log(出.trim().split('\n').slice(-2).join('\n'));
  console.log('[结果] 已私发黎路遥。');
} finally {
  try { fs.unlinkSync(临时); } catch {}
}
