#!/usr/bin/env node
// 关任务窗：把「干完就关，别攒窗口」做成工具（黎路遥 2026-10-01 企微定：照赵敏方式）。
// 任务窗的契约：干完 → 写 `任务回执/<同名>.md` → 窗口就该关。本工具负责"该关就关"。
// 用法：
//   node 关任务窗.cjs --看                     列出登记的任务窗（任务 / pid / 还活着吗 / 开了多久）
//   node 关任务窗.cjs --关 <pid|任务名>         关掉一个任务窗（连子进程）+ 摘掉登记
//   node 关任务窗.cjs --扫                     摘掉登记里已经死掉的窗口
//   node 关任务窗.cjs --守 --任务 <任务文件> --pid <pid> [--最久 4h] [--间隔 20] [--宽限 10]
//                                             守卫：盯回执文件，落地后自动关窗（开任务窗.cjs 会自动挂它）
// 登记文件：0.木婉清档案/runtime/任务窗.json（runtime/ 不入库）；守卫日志：runtime/关窗日志.log
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const 档案目录 = __dirname;
const 登记文件 = path.join(档案目录, 'runtime', '任务窗.json');
const 日志文件 = path.join(档案目录, 'runtime', '关窗日志.log');

/** 任务文件 → 它该写的回执路径（同文件名，放 任务回执/） */
function 回执路径(任务文件) {
  return path.join(档案目录, '任务回执', path.basename(String(任务文件)));
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

function 看(输出 = console.log) {
  const 窗口 = 读登记();
  if (窗口.length === 0) {
    输出('没有登记的任务窗（干净的）。');
    return 窗口;
  }
  for (const x of 窗口) {
    const 活 = 进程在(x.pid);
    const 回执 = fs.existsSync(x.回执 || 回执路径(x.任务)) ? '回执已落' : '回执未落';
    const 时长 = x.开窗时间 ? 多久(Date.now() - Date.parse(x.开窗时间)) : '?';
    输出(`${活 ? '●开' : '○关'} pid=${x.pid} ${回执} 开了${时长} ${path.basename(String(x.任务))}`);
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

/** 解析「4h / 90m / 30s」为毫秒 */
function 解析时长(文本, 默认毫秒 = 4 * 3600 * 1000) {
  const m = String(文本 || '').trim().match(/^(\d+(?:\.\d+)?)\s*([hms]?)$/i);
  if (!m) return 默认毫秒;
  const n = Number(m[1]);
  const 单位 = (m[2] || 'h').toLowerCase();
  return n * (单位 === 'h' ? 3600000 : 单位 === 'm' ? 60000 : 1000);
}

/**
 * 守卫：盯着回执文件，落地（且不早于开窗时间）→ 宽限几秒 → 关窗 + 摘登记。
 * 到「最久」还没回执 → 记日志、自己退出，**不关窗**（窗口可能还在正经干活，宁可留着让人看）。
 */
function 守卫({ 任务, pid, 最久 = 4 * 3600 * 1000, 间隔 = 20000, 宽限 = 10000, 开窗时间, 现在 = () => Date.now() } = {}) {
  const 回执 = 回执路径(任务);
  const 起 = 开窗时间 ? Date.parse(开窗时间) : 现在();
  const 截止 = 起 + 最久;
  function 滴() {
    if (!进程在(pid)) {
      摘登记(pid);
      记日志(`窗口已自行退出 pid=${pid}（${path.basename(任务)}），摘登记`);
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
        关窗(pid);
        摘登记(pid);
        记日志(`回执落地 → 关窗 pid=${pid}（${path.basename(任务)}）`);
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
    if (!项) {
      console.log(`登记里没有 ${键}（--看 一下）`);
      process.exit(1);
    }
    关窗(项.pid);
    摘登记(项.pid);
    记日志(`手动关窗 pid=${项.pid}（${path.basename(String(项.任务))}）`);
    console.log(`✓ 已关：pid=${项.pid} ${path.basename(String(项.任务))}`);
  } else if (argv.includes('--守')) {
    const 任务 = 取('--任务');
    const pid = 取('--pid');
    if (!任务 || !pid) {
      console.log('用法：node 关任务窗.cjs --守 --任务 <任务文件> --pid <pid> [--最久 4h] [--间隔 20] [--宽限 10]');
      process.exit(1);
    }
    守卫({
      任务,
      pid: Number(pid),
      最久: 解析时长(取('--最久'), 4 * 3600 * 1000),
      间隔: 解析时长(取('--间隔'), 20000),
      宽限: 解析时长(取('--宽限'), 10000),
      开窗时间: 取('--开窗时间', ''),
    });
  } else {
    console.log(`用法：
  node 关任务窗.cjs --看                    列登记的任务窗
  node 关任务窗.cjs --关 <pid|任务名>        关掉一个任务窗
  node 关任务窗.cjs --扫                    摘掉已死窗口的登记
  node 关任务窗.cjs --守 --任务 <任务文件> --pid <pid>   守卫：回执落地就关窗（开任务窗.cjs 自动挂）`);
  }
}

module.exports = { 回执路径, 读登记, 写登记, 加登记, 摘登记, 进程在, 关窗, 看, 扫, 守卫, 解析时长, 登记文件, 日志文件 };
