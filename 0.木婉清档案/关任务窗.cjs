#!/usr/bin/env node
// 关任务窗：把「干完就关，别攒窗口」做成工具（黎路遥 2026-10-01 企微定：照赵敏方式）。
// 任务窗的契约：干完 → 写回执（路径以任务书里写明的为准，缺省 `任务回执/<同名>.md`）→ 窗口就该关。本工具负责"该关就关"。
// 用法：
//   node 关任务窗.cjs --看                     列出登记的任务窗（任务 / pid / 还活着吗 / 开了多久）
//   node 关任务窗.cjs --关 <pid|任务名>         关掉一个任务窗（连子进程）+ 摘掉登记
//   node 关任务窗.cjs --扫                     摘掉登记里已经死掉的窗口
//   node 关任务窗.cjs --守 --任务 <任务文件> --pid <pid> [--最久 4h] [--间隔 20] [--宽限 10]
//                                             守卫：盯回执文件，落地后自动关窗（开任务窗.cjs 会自动挂它）
// 登记文件：0.木婉清档案/runtime/任务窗.json（runtime/ 不入库）；守卫日志：runtime/关窗日志.log
// 心跳配合（2026-10-09）：**正常收窗**顺手清 27号/.state/窗口心跳.json 里对应记录；
//   异常死亡（进程没了 / 守卫发现窗已经退了）**不清**——留着让看门狗报 [故障]。
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const 档案目录 = __dirname;
const 登记文件 = path.join(档案目录, 'runtime', '任务窗.json');
const 日志文件 = path.join(档案目录, 'runtime', '关窗日志.log');

/**
 * 任务文件 → 它该写的回执路径。
 * 2026-11-06 修：以前只会找 `任务回执/<同名>.md`，但任务书里实际指定的是各岗位自己的
 * 回执目录（例：03.巡检员·霍青桐/回执/2026-11-06-日常巡检.md）。两边不一致的后果是：
 * 回执 10:37 就落了，工具一直报「回执未落」，任务窗白开 4 小时，我还据此误判人家没交。
 * 现在判据：先看任务书里写明的路径（找 ``回执写 <路径>.md`` 或 `回执：<路径>`），
 * 再退回 `任务回执/<同名>.md`。为什么以任务书为准：任务书是派活时定的契约，
 * 工具自定义一个目录就会和契约对不上。
 */
function 回执候选(任务文件) {
  const 名 = path.basename(String(任务文件));
  const 候选 = [path.join(档案目录, '任务回执', 名)];
  // 扫机器拿到的只有文件名，先按 任务/ 目录补全，否则读不到任务书里的路径
  let 任务书 = String(任务文件);
  if (!fs.existsSync(任务书)) {
    const 猜 = path.join(档案目录, '任务', path.basename(任务书));
    if (fs.existsSync(猜)) 任务书 = 猜;
  }
  try {
    const 正文 = fs.readFileSync(任务书, 'utf8');
    const 正 = /回执[写：:]\s*`?([A-Za-z]:[^`\s|，。）)]+\.md)/g;
    const 找到 = [];
    let m;
    while ((m = 正.exec(正文))) 找到.push(m[1].replace(/\\/g, '/'));
    // 用 push 再 reverse：在循环里 unshift 会把多处命中的顺序倒过来（后出现的排最前）
    候选.unshift(...找到.reverse());
  } catch {}
  return 候选;
}

function 回执路径(任务文件) {
  const 候选 = 回执候选(任务文件);
  // 还没落时取「任务书写明的路径」（unshift 到最前），别退回我这边的 任务回执/：
  // 派别人家的窗时，回执落在对方家；退到本地会让守卫永远判「未落」，窗白开。
  return 候选.find((p) => fs.existsSync(p)) || 候选[0];
}

/**
 * 回执落没落。
 * 给了 起（开窗时间）就按 mtime 过滤——同名旧回执不算数。
 * 为什么：回执候选 现在可能有好几个路径，只看存在会把去年同名的回执当成「已落」。
 */
function 回执已落(任务文件, 起) {
  if (!任务文件) return false;
  const 下限 = 起 ? (Date.parse(起) || 0) - 60000 : 0;
  return 回执候选(任务文件).some((p) => {
    try {
      return fs.existsSync(p) && (!下限 || fs.statSync(p).mtimeMs >= 下限);
    } catch {
      return false;
    }
  });
}

function 读登记(文件 = 登记文件) {
  try {
    const j = JSON.parse(fs.readFileSync(文件, 'utf8'));
    return Array.isArray(j.窗口) ? j.窗口 : [];
  } catch {
    return [];
  }
}

function 写登记(窗口, 文件 = 登记文件) {
  fs.mkdirSync(path.dirname(文件), { recursive: true });
  fs.writeFileSync(文件, JSON.stringify({ 更新: new Date().toISOString(), 窗口 }, null, 1));
}

/** 加一条登记（同 pid 覆盖） */
function 加登记(项, 文件 = 登记文件) {
  const 窗口 = 读登记(文件).filter((x) => Number(x.pid) !== Number(项.pid));
  窗口.push(项);
  写登记(窗口, 文件);
  return 窗口;
}

/** 摘掉某 pid（或任务名）的登记，返回是否摘到 */
function 摘登记(键, 文件 = 登记文件) {
  const 全部 = 读登记(文件);
  const 剩 = 全部.filter((x) => Number(x.pid) !== Number(键) && x.任务 !== 键);
  写登记(剩, 文件);
  return 剩.length !== 全部.length;
}

function 进程在(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

/** 关掉一个进程树（Windows）；返回 true=关了 / false=本来就不在 */
function 关窗(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return true;
  } catch {
    return 进程在(pid) === false ? false : false;
  }
}

function 记日志(文本) {
  try {
    fs.mkdirSync(path.dirname(日志文件), { recursive: true });
    fs.appendFileSync(日志文件, `[${new Date().toISOString()}] ${文本}\n`);
  } catch {
    /* 日志写不进去不影响关窗 */
  }
}

function 多久(毫秒) {
  const 分 = Math.round(毫秒 / 60000);
  return 分 < 60 ? `${分} 分钟` : `${Math.floor(分 / 60)} 小时 ${分 % 60} 分`;
}

/** 解析扫描输出（纯函数，好测）：pid|MB|HH:mm|命令行 → 只留「本档案的任务窗」（命令行带 0.木婉清档案\任务\） */
function 解析窗口行(文本) {
  return String(文本 || '')
    .split(/\r?\n/)
    .map((行) => 行.trim().replace(/^\uFEFF/, ''))
    .filter((行) => /^\d+\|/.test(行))
    .map((行) => {
      const [pid, mb, 起, ...余] = 行.split('|');
      const 命令行 = 余.join('|');
      const 任务 = (命令行.match(/@(.+?\.md)/) || [])[1] || '';
      return { pid: Number(pid), 内存MB: Number(mb), 开窗: 起, 任务, 命令行 };
    })
    // 2026-10-03 收窄：只认本档案的任务窗——赵敏档案也有「任务\」子目录，旧口径把它的窗误报成我们的（有误关风险）
    .filter((x) => x.命令行.includes('0.木婉清档案\\任务\\') || x.命令行.includes('0.木婉清档案/任务/'));
}

/** 扫机器上真实在跑的「任务窗」进程（命令行带 0.木婉清档案\任务\ 的 pi）；监听窗不算。
 *  2026-10-01 用户：「窗口有点多，处理下」——那天攒了 14 扇（都是回执已落的），所以 --看 一并把残留列出来。
 *  实现：临时 ps1 + 输出走 UTF-8 文件（中文路径直接走管道会被控制台 GBK 弄乱；嵌套引号也容易崩）。 */
function 扫机器窗口({ 执行 = null } = {}) {
  const os = require('os');
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'close-win-'));
  const 脚本文件 = path.join(临时目录, '扫.ps1');
  const 输出文件 = path.join(临时目录, '出.txt');
  const 脚本 = [
    '$all = Get-CimInstance Win32_Process',
    "$pis = $all | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*pi-coding-agent*' }",
    '$pis | ForEach-Object {',
    '  $mb = [math]::Round($_.WorkingSetSize/1MB)',
    '  $t = $_.CreationDate.ToString("HH:mm")',
    '  "$($_.ProcessId)|$mb|$t|$($_.CommandLine)"',
    '} | Out-File -FilePath "' + 输出文件 + '" -Encoding utf8',
  ].join('\n');
  try {
    fs.writeFileSync(脚本文件, '﻿' + 脚本, 'utf8'); // BOM：PowerShell 5.1 才会按 UTF-8 读
    const { execFileSync } = require('child_process');
    const 跑 = 执行 || ((f) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f], { stdio: 'ignore', windowsHide: true }));
    跑(脚本文件);
    const 原始 = fs.readFileSync(输出文件, 'utf8');
    return 解析窗口行(原始);
  } catch {
    return [];
  } finally {
    try {
      fs.rmSync(临时目录, { recursive: true, force: true });
    } catch {
      /* 临时目录删不掉不影响 */
    }
  }
}

function 看(输出 = console.log) {
  const 窗口 = 读登记();
  if (窗口.length === 0) {
    输出('登记里没有任务窗。');
  } else {
    for (const x of 窗口) {
      const 活 = 进程在(x.pid);
      const 回执 = (x.回执 && fs.existsSync(x.回执)) || 回执已落(x.任务, x.开窗) ? '回执已落' : '回执未落';
      const 时长 = x.开窗时间 ? 多久(Date.now() - Date.parse(x.开窗时间)) : '?';
      输出(`${活 ? '●开' : '○关'} pid=${x.pid} ${回执} 开了${时长} ${path.basename(String(x.任务))}`);
    }
  }
  // 机器上真实在跑的任务窗（防「没登记就攒着」）
  const 机器 = 扫机器窗口();
  if (机器.length > 0) {
    输出(`—— 机器上在跑的任务窗 ${机器.length} 扇（回执落了就该关）：`);
    for (const x of 机器) {
      const 回执 = x.任务 ? 回执已落(x.任务, x.开窗) : false;
      输出(`  ${回执 ? '✔回执已落' : '…回执未落'} pid=${x.pid} ${x.开窗} ${x.内存MB}MB ${x.任务 ? path.basename(x.任务) : ''}`);
    }
    输出('  关：node 关任务窗.cjs --关 <pid>');
  }
  return 窗口;
}

/** 扫：把已死的 pid 摘掉 */
function 扫(输出 = console.log) {
  const 全部 = 读登记();
  const 活的 = 全部.filter((x) => 进程在(x.pid));
  if (活的.length !== 全部.length) 写登记(活的);
  输出(`扫完：登记 ${全部.length} → ${活的.length}（摘掉 ${全部.length - 活的.length} 个已死窗口）`);
  return 活的;
}

/**
 * 解析「4h / 90m / 30s」为毫秒。
 * 裸数字的默认单位由调用方给：`--最久` 是小时（4h/2h 这种写法习惯），`--间隔`/`--宽限` 是秒。
 *
 * 2026-11-09 为什么改这两处（实测，不是推测）：
 *  - 实测①：裸数字全按小时时，写 `--间隔 2` 就是 2 小时，守卫看着像死了——
 *    我跟假窗等了半分钟、回执也落了，一点反应都没有。而 间隔/宽限 的默认值是 20 秒/10 秒，
 *    裸数字按小时跟默认值根本不是一个量级，只绥测试的人。
 *  - 实测②：改成 `--间隔 2s --宽限 1s` 后，同一套空家目录＋假窗，
 *    回执落下 8 秒内窗就被关了（日志：「回执落地 → 关窗 pid=38772」）。
 *  - `--最久` 仍按小时：真跑就是 `--最久 4h`，反过来改会让“30”从 30 小时变 30 秒，那才是事故。
 */
function 解析时长(文本, 默认毫秒 = 4 * 3600 * 1000, 裸数字单位 = 'h') {
  const m = String(文本 || '').trim().match(/^(\d+(?:\.\d+)?)\s*([hms]?)$/i);
  if (!m) return 默认毫秒;
  const n = Number(m[1]);
  // 裸数字单位只可能是调用方传的：先 String 再校，传数字/写错单位时**报错而不是静静当秒**。
  // （只加 String 不校验的话，传个 1000 会被当成「秒」默默算下去，错得更隐蔽。）
  const 裸 = String(裸数字单位 || 'h').toLowerCase();
  if (!['h', 'm', 's'].includes(裸)) {
    throw new Error(`解析时长：裸数字单位只能是 h/m/s，收到 ${JSON.stringify(裸数字单位)}`);
  }
  const 单位 = m[2] ? m[2].toLowerCase() : 裸;
  return n * (单位 === 'h' ? 3600000 : 单位 === 'm' ? 60000 : 1000);
}

/** 规整认窗串：反斜杠、去尾斜杠、小写（Windows 路径不区分大小写） */
function 规整认窗(s) {
  return String(s || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** 心跳写手模块（懒加载；拿不到就返回 null，关窗不受影响） */
function 心跳模块() {
  try {
    return require(path.join(__dirname, '..', '27.企业微信机器人', 'scripts', '窗口心跳.cjs'));
  } catch {
    return null;
  }
}

/** 清掉某任务窗的心跳记录（只在正常收窗时调；死窗不调，留记录给看门狗报警）。返回清掉几个。 */
function 清心跳记录(任务文件, { 心跳文件 } = {}) {
  if (!任务文件) return 0;
  const 模 = 心跳模块();
  if (!模) return 0;
  const 目标 = 规整认窗('@' + 任务文件);
  return 模.清心跳(心跳文件 || 模.默认状态文件, (记录) => {
    const 组 = Array.isArray(记录 && 记录.认窗) ? 记录.认窗 : [记录 && 记录.认窗];
    return 组.some((x) => 规整认窗(x) === 目标);
  });
}

/**
 * 守卫：盯着回执文件，落地（且不早于开窗时间）→ 宽限几秒 → 关窗 + 摘登记 + 清心跳。
 * 到「最久」还没回执 → 记日志、自己退出，**不关窗**（窗口可能还在正经干活，宁可留着让人看）。
 */
function 守卫({ 任务, pid, 最久 = 4 * 3600 * 1000, 间隔 = 20000, 宽限 = 10000, 开窗时间, 现在 = () => Date.now(), 台账文件 = null, 心跳文件 = null, 回执文件 = null } = {}) {
  const 回执 = 回执文件 || 回执路径(任务);
  const 台账 = 台账文件 || 登记文件;
  const 起 = 开窗时间 ? Date.parse(开窗时间) : 现在();
  const 截止 = 起 + 最久;
  记日志(`守卫上岗 pid=${pid}（${path.basename(String(任务))}）→ 回执：${回执}`);
  function 滴() {
    if (!进程在(pid)) {
      摘登记(pid, 台账);
      记日志(`窗口已自行退出 pid=${pid}（${path.basename(任务)}），摘登记；心跳记录不清（死窗留证给看门狗）`);
      return;
    }
    let 有回执 = false;
    try {
      有回执 = fs.existsSync(回执) && fs.statSync(回执).mtimeMs >= 起 - 60000;
    } catch {
      有回执 = false;
    }
    if (有回执) {
      setTimeout(() => {
        const 活着 = 进程在(pid);
        if (活着) 清心跳记录(任务, { 心跳文件 });
        关窗(pid);
        摘登记(pid, 台账);
        记日志(`回执落地 → 关窗 pid=${pid}（${path.basename(任务)}）${活着 ? '，已清心跳' : '，窗口已自行退出（心跳留着）'}`);
      }, 宽限);
      return;
    }
    if (现在() >= 截止) {
      记日志(`守卫到点（${多久(最久)}）还没回执，窗口留着不关 pid=${pid}（${path.basename(任务)}）`);
      return;
    }
    setTimeout(滴, 间隔);
  }
  滴();
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const 取 = (名, 默认) => {
    const i = argv.indexOf(名);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : 默认;
  };
  if (argv.includes('--看')) {
    看();
  } else if (argv.includes('--扫')) {
    扫();
  } else if (argv.includes('--关')) {
    const 键 = argv[argv.indexOf('--关') + 1];
    if (!键) {
      console.log('用法：node 关任务窗.cjs --关 <pid|任务名>');
      process.exit(1);
    }
    const 项 = 读登记().find((x) => String(x.pid) === String(键) || x.任务 === 键 || path.basename(String(x.任务)) === 键);
    const pid = 项 ? 项.pid : Number(键);
    if (!项 && !Number.isFinite(pid)) {
      console.log(`登记里没有 ${键}（--看 一下；未登记的窗口可以直接给 pid）`);
      process.exit(1);
    }
    const 活着 = 进程在(pid);
    if (活着 && 项) 清心跳记录(项.任务);
    关窗(pid);
    摘登记(pid);
    记日志(`手动关窗 pid=${pid}（${项 ? path.basename(String(项.任务)) : '未登记，按 pid 关'}）${活着 && 项 ? '，已清心跳' : ''}`);
    console.log(`✓ 已关：pid=${pid}${项 ? ' ' + path.basename(String(项.任务)) : ''}`);
  } else if (argv.includes('--守')) {
    const 任务 = 取('--任务');
    const pid = 取('--pid');
    if (!任务 || !pid) {
      console.log('用法：node 关任务窗.cjs --守 --任务 <任务文件> --pid <pid> [--最久 4h] [--间隔 20s] [--宽限 10s] [--回执 <绝对路径>]（裸数字：最久＝小时，间隔/宽限＝秒）');
      process.exit(1);
    }
    const 回执文件 = 取('--回执', '');
    守卫({
      任务,
      pid: Number(pid),
      最久: 解析时长(取('--最久'), 4 * 3600 * 1000, 'h'),   // 裸数字＝小时（4h/2h）
      间隔: 解析时长(取('--间隔'), 20000, 's'),   // 裸数字＝秒，跟默认值 20 秒对齐
      宽限: 解析时长(取('--宽限'), 10000, 's'),   // 裸数字＝秒，跟默认值 10 秒对齐
      开窗时间: 取('--开窗时间', ''),
      // 2026-11-09 加：派活工具知道对方家的真实回执路径，显式传进来就不用从任务书正文里猜。
      //   不传＝走 回执候选()（默认＋任务书里写明的绝对路径），手动派窗的场景照旧。
      回执文件,
    });
  } else {
    console.log(`用法：
  node 关任务窗.cjs --看                    列登记的任务窗
  node 关任务窗.cjs --关 <pid|任务名>        关掉一个任务窗
  node 关任务窗.cjs --扫                    摘掉已死窗口的登记
  node 关任务窗.cjs --守 --任务 <任务文件> --pid <pid>   守卫：回执落地就关窗（开任务窗.cjs 自动挂）
    --最久 4h（裸数字＝小时）  --间隔 20s（裸数字＝秒）  --宽限 10s  --回执 <绝对路径>`);
  }
}

module.exports = { 回执路径, 读登记, 写登记, 加登记, 摘登记, 进程在, 关窗, 看, 扫, 扫机器窗口, 解析窗口行, 守卫, 解析时长, 清心跳记录, 规整认窗, 登记文件, 日志文件 };
