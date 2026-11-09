#!/usr/bin/env node
// 派活：把一份「任务说明.md」交给一个新的 pi 窗口（任务窗）去干。
// 约定（2026-10-01 用户拍板，照赵敏方式）：
//   ① 任务窗**只写回执、不直接发企微**（只有监听窗跟他联系）；任务窗不提交 git；
//   ② **干完就关窗**——本工具派窗时自动挂「关任务窗.cjs --守」守卫：回执落地就关窗、摘登记；
//   ③ 一个活能拆小块 → 就在这个窗里用「编排」带帮手并行（≤8），别开一堆窗。
// 用法：node 开任务窗.cjs "任务/2026-11-01-xxx.md" <工作目录>
//   工作目录必填（2026-11-05 黎路遥定防呆）：自己家的活写 `.`，派给别人写对方家绝对路径。
//   为什么不再默认本仓：当天派探域核查时漏传这个参数，窗默默开在木婉清家，
//   对方的 AGENTS／工具／历史全没加载，老板看到一扇莫名其妙的「木婉清窗」。
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
  console.log('用法：node 开任务窗.cjs "任务/xxx.md" <工作目录>');
  process.exit(1);
}

// ── 防呆：工作目录必须显式给，不许默默兜底成「本仓」──
// 2026-11-05 黎路遥：「如果缺少参数就报错，而不是兜底，这样你就知道搞错了」。
const 目录原文 = String(目录参数 || '').trim();
if (!目录原文) {
  console.error('✗ 缺第二个参数「工作目录」——本工具不再默认开在本仓。');
  console.error('  为什么：2026-11-05 派「抖音3店核查」时漏传，窗开在了木婉清家，');
  console.error('  对方的 AGENTS、工具、历史全部没加载，老板看到一扇不该出现的木婉清窗。');
  console.error('');
  console.error('  自己家的活：  node 开任务窗.cjs "0.木婉清档案/任务/xxx.md" .');
  console.error('  派给别人：    node 开任务窗.cjs "0.木婉清档案/任务/xxx.md" "D:/硅基公司/员工/09.探域专员·殷素素"');
  process.exit(2);
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
const 工作目录 = path.resolve(process.cwd(), 目录原文);
const 本仓 = path.resolve(本目录, '..');
if (!fs.existsSync(工作目录)) {
  console.log('工作目录不存在：' + 工作目录);
  process.exit(1);
}
// 2026-11-06 防呆（黎路遥：「工具层面要防呆设计，只能叫一个窗口」）
// 同一个家目录已经有活着的 pi 会话时拒绝开窗：第二扇会复用同一个会话文件、把原窗的唤醒环顶掉，
// 原窗从此不响应，但「看窗」还显示在跑（2026-11-06 一天踩两次：素素家把老板要的验收窗顶没了、巡检家多出第二扇）。
// 只对别人的家目录硬拦；本仓的监听窗＋任务窗本来就要共存，只提醒不拦。
// 2026-11-06 二次修（真因）：窗口进程的命令行里**没有家目录名**，只有任务书路径——
// 实测 pid 36900 的命令行是 `node cli.js @D:\...\任务6-11-06-探域每日优化.md --provider ...`。
// 所以按「命令行含目录名」判活窗，既漏判真窗（该拦不拦），又会把自己算进去（每次报不同 pid）。
// 现改成两条判据：
//   ① 全局任务窗：命令行里带 `0.木婉清档案\任务\<某任务书>.md` 的 pi 主进程 = 已有一扇任务窗在跑。
//      这正好对上本仓规矩「一次只拉一个任务窗」，不管它开在谁家。
//   ② 同目录：命令行里带该家目录（`pi` 从该目录起的窗、或带 boot-prompt 绝对路径的窗）。
function 列进程() {
  const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like "*-coding-agent*" -and $_.CommandLine -notlike "*开任务窗.cjs*" -and $_.CommandLine -notlike "*心跳*" -and $_.CommandLine -notlike "*叫醒器*" -and $_.CommandLine -notlike "*守护*" -and $_.CommandLine -notlike "*跟读*" } | ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`;
  try {
    const 出 = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 20000 });
    return 出.split(String.fromCharCode(13)).join('').split(String.fromCharCode(10))
      .map((x) => x.trim()).filter(Boolean)
      .map((x) => { const k = x.indexOf('|'); return { pid: k > 0 ? x.slice(0, k) : '', cmd: k > 0 ? x.slice(k + 1) : x }; })
      .filter((o) => /^\d+$/.test(o.pid) && Number(o.pid) !== process.pid);
  } catch {
    return []; // 查不到就放行：宁可多开一扇，也不要把派活堵死
  }
}

function 同目录活窗(目录) {
  const 家 = String(目录).toLowerCase();
  const 命中 = [];
  const 已计 = new Set();
  // ① 本工具登记过的任务窗：**按登记里的工作目录比**。命令行里看不见 cwd（pi 启动时参数是 @任务/xxx.md），
  //    所以任务窗是“哪家的”只能靠登记说。
  //    2026-11-09 修：以前只要命令行里出现「0.木婉清档案\任务」就算命中，
  //    结果我自己的文档优化任务窗（43440）把派给霍青桐的窗给堵了——一个全公司范围的误报。
  let 登 = [];
  try {
    const { 读登记, 进程在 } = require(path.join(本目录, '关任务窗.cjs'));
    const 活 = (pid) => { try { return 进程在(pid); } catch { return false; } };
    for (const x of 读登记()) {
      if (!x || !x.工作目录) continue; // 旧登记没记工作目录：认不出是哪家，不硬猜（下次开窗会补上）
      if (String(x.工作目录).toLowerCase() !== 家) continue;
      if (!活(Number(x.pid))) continue;
      命中.push(x.pid + '（任务窗：' + path.basename(String(x.任务 || '')) + '）');
      已计.add(String(x.pid));
    }
  } catch {}
  // ② 命令行里就带着这家路径的窗（监听窗／boot-prompt 窗）
  for (const p of 列进程()) {
    const cl = p.cmd.toLowerCase();
    if (cl.includes(家) && !已计.has(String(p.pid))) 命中.push(p.pid + '（同家目录的窗）');
  }
  return 命中;
}
const 是自己的家 = 工作目录.toLowerCase() === 本仓.toLowerCase();
const 活窗 = 是自己的家 ? [] : 同目录活窗(工作目录);
if (process.argv.includes('--只查窗')) { console.log('同目录活窗：' + (活窗.length ? 活窗.join('、') : '无')); process.exit(0); } // 自检用：只报不派
if (活窗.length && !process.argv.includes('--强开')) {
  console.log('✗ 拒开：' + path.basename(工作目录) + ' 家里已经有窗在跑（pid ' + 活窗.join('、') + '）。');
  console.log('  同一目录只能有一扇窗：第二扇会复用同一个会话文件、把原窗的唤醒环顶掉，原窗从此不响应（但看着还是在跑）。');
  console.log('  正解：把那件事私信给她，让她自己那扇窗干；或者等她那扇窗退了再派。');
  console.log('  确认要多开就加 --强开。');
  process.exit(3);
}
// 开窗前把「这个窗到底会加载哪份 AGENTS」写在脸上，防止窗名跟真身不匹配。
const 窗AGENTS = path.join(工作目录, 'AGENTS.md');
const 是不是本仓 = 工作目录.toLowerCase() === 本仓.toLowerCase();
if (是不是本仓) {
  console.log('工作目录：本仓（木婉清）' + (fs.existsSync(窗AGENTS) ? '　AGENTS.md ✓' : '　⚠ 没有 AGENTS.md'));
} else {
  console.log('工作目录：' + 工作目录 + (fs.existsSync(窗AGENTS) ? '　AGENTS.md ✓' : '　⚠ 对方家没有 AGENTS.md（它只靠任务书干活）'));
  console.log('  ↳ 非本仓：请确认任务书里写明的「干活人」就是这个目录的主人');
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
// --干：只演练、不起窗口（防呆自查用：确认任务文件/工作目录/模型都对，再真开）
if (process.argv.includes('--干')) {
  console.log('（--干：只演练，没有起窗口）');
  console.log('  任务文件：' + 任务文件);
  console.log('  工作目录：' + 工作目录);
  process.exit(0);
}
let pid = 0;
try {
  const 输出 = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  pid = Number((输出.match(/(\d+)/) || [])[1] || 0);
  console.log('任务窗进程号：' + (pid || '（没读到）'));
} catch (e) {
  console.log('派活失败：' + String((e && e.message) || e));
  process.exit(1);
}

// 2026-11-09（#720）：--回执 <绝对路径> —— 派活工具知道对方家的真实回执路径，显式传进来，
//   不用从任务书正文里猜。不传则走 关任务窗.回执路径()（默认＋任务书里写明的路径）。
const 取参数 = (名) => {
  const i = process.argv.indexOf(名);
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
};
const 指定回执 = 取参数('--回执');

// 登记 + 挂守卫（回执落地就关窗）——「干完就关，别攒窗口」
const 关窗工具 = path.join(本目录, '关任务窗.cjs');
const 开窗时间 = new Date().toISOString();
if (pid > 0) {
  const { 加登记, 回执路径 } = require(关窗工具);
  const 回执 = 指定回执 || 回执路径(任务文件);
  // --不收窗：黎路遥 2026-11-05 10:4x「探域那边处理完你让他别收窗，今天还有很多事情要做」
  // 为什么要有这个开关：默认「回执落地就关窗」对一次性活是对的，但同一家今天还要接着派活时，
  // 关了就得重开一扇、上下文（已读的代码/已查的证据）全丢，重烧一遍 token。
  const 不收窗 = process.argv.includes('--不收窗');
  加登记({ 任务: 任务文件, 工作目录, 回执, pid, 开窗时间, 守卫最久: 不收窗 ? '不自动关' : '4h' });
  if (!不收窗) {
    const 守卫参数 = [关窗工具, '--守', '--任务', 任务文件, '--pid', String(pid), '--最久', '4h', '--开窗时间', 开窗时间];
    if (指定回执) 守卫参数.push('--回执', 指定回执);
    const 参数字面量 = 守卫参数.map((x) => `'${x}'`).join(',');
    const 挂守卫 = `Start-Process -FilePath '${process.execPath}' -ArgumentList ${参数字面量} -WorkingDirectory '${本目录}' -WindowStyle Hidden`;
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', 挂守卫], { stdio: 'ignore' });
      console.log('✓ 已挂守卫：回执一落地就自动关窗（最多守 4 小时；没回执则留着不关）');
    } catch (e) {
      console.log('⚠ 守卫没挂上（窗口照开）：' + String((e && e.message) || e));
    }
  } else {
    console.log('✓ --不收窗：没挂守卫，回执落地也不关窗（活干完由人或主窗决定）');
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
