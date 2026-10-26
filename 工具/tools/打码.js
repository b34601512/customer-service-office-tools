#!/usr/bin/env node
/**
 * 打码小工具：扫描仓库里还有哪些「真值」，并收进本机对照表（`tools/打码对照.local`）。
 *
 *   node tools/打码.js --扫描        只列清单（真值 → 拟打码值 + 出现位置），不写任何东西
 *   node tools/打码.js --学          把扫到的真值写进对照表（之后提交/检出就自动打码/还原）
 *   node tools/打码.js --自检        跑一遍「打码→还原」往返自检
 *
 * 打码只影响 **提交给 GitHub 的内容**；本机文件始终是真值（靠 `tools/打码过滤器.js` 的 smudge 还原）。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { 仓库根, 读对照, 写对照, 生成打码值, 不打的词 } = require('./打码字典');

const 文本后缀 = /\.(md|json|js|cjs|py|txt|yml|yaml|ps1|bat)$/i;

/** 员工名单：优先读 28号 的**本机**配置（不入库那份），用于识别真实姓名 */
function 读名单() {
  const 名 = new Set();
  const 候选 = [
    path.join(仓库根, '28.排班与派活', 'project-config', '排班值班配置.json'),
    path.join(仓库根, '28.排班与派活', 'project-config', '排班值班配置.example.json'),
  ];
  for (const p of 候选) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const 组 of Object.values(j.分组名单 || {})) for (const 人 of Object.keys(组 || {})) 名.add(人);
    } catch (e) { /* 没有就算了 */ }
  }
  // 兜底：仓库里出现过的同事姓名（用户/经理在文档里点名的人）
  ['缪某某', '李某某', '陈某某', '柯某某', '邓某某', '叶某某', '徐某某', '刘某某', '韩某某', '林某某', '万某某', '陈某某'].forEach((n) => 名.add(n));
  return [...名];
}

/** 明显是测试造的假值（138000001xx / 123456… / 客服乙这类占位）或已经打过码的形态，不占用对照表 */
function 像假的(值, 类别) {
  if (值 === 生成打码值(值)) return true;          // 它本身就是打码值形态
  if (/^s3_A+$/.test(值)) return true;             // 自检用的假 docid
  if (类别 === '手机号') return /^1\d{2}0{5,}/.test(值) || /1234567|000000\d{0,2}$/.test(值);
  if (类别 === '订单号') return /^(123456|654321)-/.test(值) || /1234567890|9876543210/.test(值) || /-0{6,}/.test(值);
  if (类别 === '子账号') return /[甲乙丙丁戊己庚辛壬癸某]$/.test(值);
  return /^(\d)\1+$/.test(值);
}

function 扫真值(文件清单) {
  const 规则 = [
    [/(?<![\d-])\d{6}-\d{9,15}(?![\d-])/g, '订单号'],
    [/(?<![A-Za-z0-9])(?:SF|JDV|YT|ZTO|JT|EMS|YD)\d{10,}(?![\d])/g, '快递单号'],
    [/s3_[A-Za-z0-9]{10,}/g, '内部docid'],
    [/(?<![A-Za-z0-9_])(?=wo[A-Za-z0-9_-]*\d)(?=wo[A-Za-z0-9_-]*[A-Z])wo[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_])/g, '企微userid'],
    [/(?<!\d)1[3-9]\d{9}(?!\d)/g, '手机号'],
  ];
  const 名单 = 读名单();
  const 命中 = new Map(); // 真值 → {类别, 处数, 文件:Set}
  const 记 = (值, 类别, 文件) => {
    if (不打的词.has(值)) return;
    if (像假的(值, 类别)) return;
    const 旧 = 命中.get(值) || { 类别, 处数: 0, 文件: new Set() };
    旧.处数 += 1; 旧.文件.add(文件);
    命中.set(值, 旧);
  };
  for (const f of 文件清单) {
    let s; try { s = fs.readFileSync(path.join(仓库根, f), 'utf8'); } catch (e) { continue; }
    for (const [re, 类别] of 规则) for (const m of s.match(re) || []) 记(m, 类别, f);
    for (const n of 名单) if (s.includes(n)) 记(n, '姓名', f);
    // 子账号：`:客服辛` / `:小黛`（排除「客服部/客服口径/小芳休」这类常见词）
    for (const m of s.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}[：:](?:客服|小)[\u4e00-\u9fa5](?![一-龥])/g) || []) {
      const 尾 = m.slice(-1);
      if (['部', '口', '是', '群', '先', '回', '务', '服', '人', '员', '机', '器', '话', '时', '芳', '计', '店', '培', '规', '二', '三', '四', '五', '六', '七', '八', '九', '十', '于', '的', '与', '在'].includes(尾)) continue;
      记(m.replace(/^.*[：:]/, '：'), '子账号', f);
    }
  }
  return 命中;
}

function 列跟踪文本文件() {
  const 出 = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: 仓库根, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return 出.split('\n').filter(Boolean).map((f) => f.replace(/^"|"$/g, '')).filter((f) => 文本后缀.test(f));
}

function 扫描({ 学 }) {
  const 表 = 读对照();
  const 命中 = 扫真值(列跟踪文本文件());
  const 新的 = [];
  console.log('\n序号 | 类别 | 真值 | 拟打码值 | 出现处数 | 举例文件');
  console.log('---|---|---|---|---|---');
  let i = 0;
  for (const [值, 信息] of [...命中.entries()].sort((a, b) => b[1].处数 - a[1].处数)) {
    i += 1;
    const 打 = 表[值] || 生成打码值(值);
    if (!表[值]) 新的.push(值);
    console.log(`${i} | ${信息.类别} | ${值} | ${打} | ${信息.处数} | ${[...信息.文件][0]}`);
  }
  console.log(`\n合计 ${i} 个真值，其中 ${新的.length} 个还没进对照表。`);
  if (学 && 新的.length) {
    for (const 值 of 新的) 表[值] = 生成打码值(值);
    写对照(表);
    console.log(`已写入对照表：${新的.length} 条（tools/打码对照.local，本机私有不入库）`);
  }
  return 新的.length;
}

function 自检() {
  const 样 = '李某某 让 缪某某 查 260925-***********0145（SF*********0944）在 s3_AAAAAAAAAAAAAAAAAAAA 里，账号 德达旗舰店:客服辛';
  const 表 = { 李某某: '李某某', 缪某某: '缪某某', '260925-***********0145': 生成打码值('260925-***********0145'), SF*********0944: 生成打码值('SF*********0944'), s3_AAAAAAAAAAAAAAAAAAAA: 生成打码值('s3_AAAAAAAAAAAAAAAAAAAA'), '德达旗舰店:客服辛': '德达旗舰店:客服某' };
  const { 替换 } = require('./打码字典');
  const 打 = 替换(样, '打码', 表);
  const 回 = 替换(打, '还原', 表);
  console.log('原样  ：' + 样);
  console.log('打码后：' + 打);
  console.log('还原后：' + 回);
  const ok = 回 === 样 && 打 !== 样 && !打.includes('李某某') && !打.includes('260925-***********0145');
  console.log(ok ? '✅ 自检通过（往返一致、且真值确实被遮住）' : '❌ 自检失败');
  process.exitCode = ok ? 0 : 1;
}

function 核对() {
  const 表 = 读对照();
  const 键 = Object.keys(表).sort((a, b) => b.length - a.length);
  if (!键.length) { console.log('对照表是空的，先跑 node tools/打码.js --学'); process.exitCode = 2; return; }
  const 文件 = 列跟踪文本文件();
  const 漏 = [];
  for (const f of 文件) {
    let s;
    try { s = execFileSync('git', ['show', 'HEAD:' + f], { cwd: 仓库根, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { continue; }
    for (const k of 键) if (s.includes(k)) 漏.push(`${f} 里有真值「${k}」`);
  }
  if (漏.length) {
    console.log('❌ 提交给 GitHub 的内容里还有真值：');
    漏.slice(0, 30).forEach((x) => console.log('   ' + x));
    console.log(`（共 ${漏.length} 处；多数是因为还没重新提交这些文件——改一下就提交，或跑 node tools/打码.js --重提）`);
    process.exitCode = 1;
  } else {
    console.log(`✅ 核对通过：HEAD 里 ${文件.length} 个文本文件都没有对照表里的真值`);
  }
}

function 体检() {
  const 配置 = execFileSync('git', ['config', '--get-regexp', '^filter\\.'], { cwd: 仓库根, encoding: 'utf8' }).trim();
  const 有clean = /filter\.打码\.clean/.test(配置);
  const 有smudge = /filter\.打码\.smudge/.test(配置);
  const 有规则 = fs.readFileSync(path.join(仓库根, '.gitattributes'), 'utf8').includes('filter=打码');
  console.log(`过滤器配置：clean=${有clean ? '✓' : '✗'} smudge=${有smudge ? '✓' : '✗'} 规则=${有规则 ? '✓' : '✗'}`);
  if (!有clean || !有smudge) console.log('  本机启用（一次性）：\n   git config filter.打码.clean "node tools/打码过滤器.js clean"\n   git config filter.打码.smudge "node tools/打码过滤器.js smudge"');
  自检();
  process.exitCode = 有clean && 有smudge && 有规则 ? 0 : 1;
}

if (require.main === module) {
  const 参 = new Set(process.argv.slice(2));
  if (参.has('--自检')) 自检();
  else if (参.has('--核对')) 核对();
  else if (参.has('--体检')) 体检();
  else if (参.has('--扫描') || 参.has('--学')) 扫描({ 学: 参.has('--学') });
  else { console.log('用法：node tools/打码.js --扫描 | --学 | --自检 | --核对 | --体检'); process.exitCode = 2; }
}

module.exports = { 扫真值, 列跟踪文本文件, 读名单, 核对 };
