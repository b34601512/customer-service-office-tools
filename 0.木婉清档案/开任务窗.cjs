#!/usr/bin/env node
// 派活：把一份「任务说明.md」交给一个新的 pi 窗口（任务窗）去干。
// 约定（2026-10-01 用户拍板，照赵敏方式）：
//   ① 任务窗**只写回执、不直接发企微**（只有监听窗跟他联系）；任务窗不提交 git；
//   ② **干完就关窗**——本工具派窗时自动挂「关任务窗.cjs --守」守卫：回执落地就关窗、摘登记；
//   ③ 一个活能拆小块 → 就在这个窗里用「编排」带帮手并行（≤8），别开一堆窗。
// 用法：node 开任务窗.cjs "任务/2026-10-01-xxx.md" ["工作目录，默认仓库根"]
// 看/手动关：node 关任务窗.cjs --看 / --关 <pid|任务名>
// 窗口心跳（2026-10-09）：派窗后自动给这个窗挂心跳写手，窗口挂 → 心跳停 → 看门狗报警。
// 原理：PowerShell Start-Process 起新控制台窗口（直接 spawn 不会弹新窗口）；
//       同步等它把窗口拉起再返回——detached 后台跑 powershell，父进程一退它可能被连带清掉，窗口悄悄起不来。
// 来源：照 `D:\桌面\个人软件\00.赵敏档案\开任务窗.mjs` 移植（2026-10-01，用户让学赵敏）。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const 本目录 = __dirname;
const [任务参数, 目录参数] = process.argv.slice(2);
if (!任务参数) {
  console.log('用法：node 开任务窗.cjs "任务/xxx.md" ["工作目录"]');
  process.exit(1);
}
const 任务文件 = path.resolve(process.cwd(), 任务参数);
if (!fs.existsSync(任务文件)) {
  console.log('找不到任务说明：' + 任务文件);
  process.exit(1);
}

// ── 红线拦截：发票登记不许我开任务窗自己干（黎路遥 2026-10-24 08:40 连问两遍「不是有发票专员吗」）──
// 为什么做到「派窗」这一层：光写规矩拦不住手，任务书里出现写表工具就根本不能开工。
// 正解：转发票专员·李沅芷（`node 工具/企微/私信.cjs 发票专员·李沅芷 "…"` + `node "D:/硅基公司/员工/发票专员·李沅芷/工具/企微/开窗.ps1"`）。
const 禁词 = [
  ['写登记表.js', '发票登记（写金山登记表）'],
  ['写同单备注.js', '发票登记（写备注）'],
  ['自动登记发票', '发票登记'],
  ['发票登记表', '发票登记'],
];
const 正文 = fs.readFileSync(任务文件, 'utf8');
const 命中 = 禁词.filter(([词]) => 正文.includes(词));
if (命中.length) {
  console.log('✗ 拒派：任务书里有「' + 命中.map(([, 名]) => 名 + '（' + 命中.find(([w]) => 正文.includes(w))[0] + '）').join('、') + '」。');
  console.log('  发票登记归发票专员·李沅芷，我不代登（规矩与红线 §三；黎路遥 2026-10-24 定）。');
  console.log('  正解：私信她 + 给她开窗——');
  console.log('    node "D:/桌面/木婉清/工具/企微/私信.cjs" 发票专员·李沅芷 "<清楚的任务：单号 / 要她做什么 / 料在哪>"');
  console.log('    node "D:/硅基公司/员工/发票专员·李沅芷/工具/企微/开窗.ps1"');
  console.log('  叫不动就开 GitHub issue 挂着等人，不许自己下手。');
  process.exit(2);
}
const 工作目录 = path.resolve(process.cwd(), 目录参数 || path.join(本目录, '..'));
if (!fs.existsSync(工作目录)) {
  console.log('工作目录不存在：' + 工作目录);
  process.exit(1);
}
const pi = 'C:\\Users\\b3460\\AppData\\Local\\PiCodingAgentInstaller\\bin\\pi.cmd';
if (!fs.existsSync(pi)) {
  console.log('找不到 pi 启动器：' + pi);
  process.exit(1);
}

// 唯一模型来源：共享清单按本家绝对路径选择；清单异常时不开任务窗。
const { 解析开窗模型, 模型参数 } = require('D:/硅基公司/共享/企微工具/解析开窗模型.cjs');
let 模型选择;
try {
  模型选择 = 解析开窗模型(path.resolve(本目录, '..'));
} catch (error) {
  console.error('✗ 开窗模型清单读取失败：' + String((error && error.message) || error));
  process.exit(2);
}
console.log(`窗口模型：${模型选择.provider}/${模型选择.model}（thinking=${模型选择.thinking}）`);

// Start-Process 会把参数数组拼成命令行；仅含空格的任务路径需要保留双引号。
function psQuote(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function winArg(value) {
  const text = String(value);
  return /[\s"]/.test(text) ? '"' + text.replace(/"/g, '\\"') + '"' : text;
}
const 参数字面量 = [`@${任务文件}`, ...模型参数(模型选择)].map(winArg).map(psQuote).join(',');
const ps = `$p = Start-Process -FilePath ${psQuote(pi)} -ArgumentList @(${参数字面量}) -WorkingDirectory ${psQuote(工作目录)} -PassThru -ErrorAction Stop; $p.Id`;
let pid = 0;
try {
  const 输出 = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  pid = Number((输出.match(/(\d+)/) || [])[1] || 0);
  console.log('任务窗进程号：' + (pid || '（没读到）'));
} catch (e) {
  console.log('派活失败：' + String((e && e.message) || e));
  process.exit(1);
}

// 登记 + 挂守卫（回执落地就关窗）——「干完就关，别攒窗口」
const 关窗工具 = path.join(本目录, '关任务窗.cjs');
const 开窗时间 = new Date().toISOString();
if (pid > 0) {
  const { 加登记, 回执路径 } = require(关窗工具);
  加登记({ 任务: 任务文件, 回执: 回执路径(任务文件), pid, 开窗时间, 守卫最久: '4h' });
  const 守卫参数 = [关窗工具, '--守', '--任务', 任务文件, '--pid', String(pid), '--最久', '4h', '--开窗时间', 开窗时间];
  const 参数字面量 = 守卫参数.map((x) => `'${x}'`).join(',');
  const 挂守卫 = `Start-Process -FilePath '${process.execPath}' -ArgumentList ${参数字面量} -WorkingDirectory '${本目录}' -WindowStyle Hidden`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', 挂守卫], { stdio: 'ignore' });
    console.log('✓ 已挂守卫：回执一落地就自动关窗（最多守 4 小时；没回执则留着不关）');
  } catch (e) {
    console.log('⚠ 守卫没挂上（窗口照开）：' + String((e && e.message) || e));
  }

  // 挂窗口心跳（2026-10-09）：写手认真实 pi 进程（--认窗 @任务文件），窗口挂=写手停、心跳过期 → 看门狗报警。
  const 心跳脚本 = path.join(本目录, '..', '27.企业微信机器人', 'scripts', '窗口心跳.cjs');
  if (fs.existsSync(心跳脚本)) {
    try {
      execFileSync(process.execPath, [
        心跳脚本, '--后台',
        '--认窗', '@' + 任务文件,
        '--名', '任务窗·' + path.basename(任务文件),
        '--类型', 'task',
      ], { stdio: 'ignore', windowsHide: true, timeout: 15000 });
      console.log('✓ 已挂窗口心跳：窗口一挂写手就停，看门狗 10 分钟内会报 [故障]');
    } catch (e) {
      console.log('⚠ 窗口心跳没挂上（窗口照开）：' + String((e && e.message) || e));
    }
  }
} else {
  console.log('⚠ 没读到窗口进程号，没登记也没挂守卫；用 `node 关任务窗.cjs --看` 核对');
}

console.log('✓ 任务窗已派：' + 任务文件);
console.log('  工作目录：' + 工作目录);
console.log('  看/关：node 关任务窗.cjs --看 / --关 ' + (pid || '<pid>'));
