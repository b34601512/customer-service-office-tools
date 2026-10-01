#!/usr/bin/env node
// 派活：把一份「任务说明.md」交给一个新的 pi 窗口（任务窗）去干。
// 约定（2026-10-01 用户拍板）：任务窗**只写回执、不直接发企微**（只有监听窗跟他联系）；任务窗不提交 git。
// 用法：node 开任务窗.cjs "任务/2026-10-01-xxx.md" ["工作目录，默认仓库根"]
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

// 单引号 PowerShell 字符串：这些路径不含单引号，安全
const ps = `$p = Start-Process -FilePath '${pi}' -ArgumentList '@${任务文件}' -WorkingDirectory '${工作目录}' -PassThru -ErrorAction Stop; "任务窗进程号：" + $p.Id`;
try {
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
} catch (e) {
  console.log('派活失败：' + String((e && e.message) || e));
  process.exit(1);
}

console.log('✓ 任务窗已派：' + 任务文件);
console.log('  工作目录：' + 工作目录);
