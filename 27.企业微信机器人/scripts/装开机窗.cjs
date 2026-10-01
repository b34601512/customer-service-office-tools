#!/usr/bin/env node
// 装/卸「开机自动开 Pi 监听窗」的启动快捷方式（幂等，可重复跑）。
//
// 用法：
//   node scripts/装开机窗.cjs           # 装/修复（装完自动回读校验）
//   node scripts/装开机窗.cjs --看       # 只回读：快捷方式指向哪
//   node scripts/装开机窗.cjs --卸载     # 卸掉
//
// 原理：在 Windows「启动」文件夹放一个 .lnk → scripts/open-pi-window.cmd
//       （cmd 在仓库根起 pi，首条指令 = 27号/boot-prompt.md，窗口自己挂监听）。
// 为什么绕 PowerShell：.lnk 是二进制；用「UTF-8 带 BOM 的 .ps1 文件」喂 PowerShell，
//       中文路径不经过命令行代码页，最稳（赵敏那边同招，已实测）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const 脚本目录 = __dirname;
const 项目根 = path.resolve(脚本目录, '..', '..'); // D:\桌面\办公软件
const 开窗脚本 = path.join(脚本目录, 'open-pi-window.cmd');
const 启动夹 = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const 快捷方式 = path.join(启动夹, '木婉清-开机开窗.lnk');

/** 跑一段 PowerShell（脚本带 BOM 存成临时 .ps1，中文路径最稳）。 */
function 跑PS(命令) {
  const ps1 = path.join(os.tmpdir(), '木婉清-开机窗.ps1');
  fs.writeFileSync(ps1, '\ufeff' + 命令.join('\r\n') + '\r\n', 'utf8');
  const 结果 = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { encoding: 'utf8' });
  try { fs.unlinkSync(ps1); } catch { /* 忽略 */ }
  return 结果;
}

/** 回读快捷方式（PS 写 UTF-8 JSON 临时文件，Node 再读 —— 避开控制台代码页乱码）。 */
function 读快捷方式() {
  if (!fs.existsSync(快捷方式)) return null;
  const 出 = path.join(os.tmpdir(), '木婉清-开机窗-读取.json');
  const 命令 = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$s = $ws.CreateShortcut('${快捷方式}')`,
    `@{ TargetPath = $s.TargetPath; Arguments = $s.Arguments; WorkingDirectory = $s.WorkingDirectory; Description = $s.Description } | ConvertTo-Json | Out-File -Encoding utf8 '${出}'`,
  ];
  const 结果 = 跑PS(命令);
  if (结果.status !== 0) throw new Error('读取快捷方式失败：' + String(结果.stderr || '').trim());
  const 文本 = fs.readFileSync(出, 'utf8').replace(/^\uFEFF/, '');
  try { fs.unlinkSync(出); } catch { /* 忽略 */ }
  return JSON.parse(文本);
}

function 装() {
  if (!fs.existsSync(开窗脚本)) {
    console.error('找不到开窗脚本：' + 开窗脚本);
    return 1;
  }
  fs.mkdirSync(启动夹, { recursive: true });
  const 命令 = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$s = $ws.CreateShortcut('${快捷方式}')`,
    `$s.TargetPath = '${开窗脚本}'`,
    "$s.Arguments = ''",
    `$s.WorkingDirectory = '${项目根}'`,
    "$s.Description = '木婉清 · 开机自动开 Pi 监听窗'",
    '$s.Save()',
  ];
  const 结果 = 跑PS(命令);
  if (结果.status !== 0) {
    console.error('装快捷方式失败：' + String(结果.stderr || '').trim());
    return 1;
  }
  const 实际 = 读快捷方式();
  if (!实际 || 实际.TargetPath !== 开窗脚本 || 实际.WorkingDirectory !== 项目根) {
    console.error('回读校验不通过，实际为：' + JSON.stringify(实际));
    return 1;
  }
  console.log('✓ 已装开机监听窗：' + 快捷方式);
  console.log('  目标：' + 实际.TargetPath);
  console.log('  工作目录：' + 实际.WorkingDirectory);
  console.log('  （下次登录 Windows 自动开窗并挂监听；卸掉：node scripts/装开机窗.cjs --卸载）');
  return 0;
}

function 看() {
  const 实际 = 读快捷方式();
  if (!实际) {
    console.log('没装（' + 快捷方式 + ' 不存在）');
    return 1;
  }
  console.log('已装：' + 快捷方式);
  console.log('  目标：' + 实际.TargetPath);
  console.log('  参数：' + (实际.Arguments || '（无）'));
  console.log('  工作目录：' + 实际.WorkingDirectory);
  console.log('  说明：' + (实际.Description || '（无）'));
  return 0;
}

function 卸() {
  if (fs.existsSync(快捷方式)) {
    fs.unlinkSync(快捷方式);
    console.log('已卸掉开机监听窗：' + 快捷方式);
  } else {
    console.log('本来就没装开机监听窗');
  }
  return 0;
}

if (require.main === module) {
  const 参数 = process.argv.slice(2);
  const 码 = 参数.includes('--卸载') ? 卸() : 参数.includes('--看') ? 看() : 装();
  process.exitCode = 码;
}

module.exports = { 装, 卸, 看, 快捷方式, 开窗脚本, 项目根 };
