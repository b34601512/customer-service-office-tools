const { spawnSync } = require('child_process');
const { 项目根目录, 进程登记文件路径 } = require('./paths');
const { 读取JSON文件, 写入JSON文件 } = require('./fs');
const { 打印日志 } = require('./logger');

const 浏览器进程名集合 = new Set(['chrome.exe', 'msedge.exe', 'chromium.exe']);
const 项目标记参数名 = '--invoice-download-center-owner-pid';

function 读取进程登记() {
  // 这个函数解决后台启动后能知道哪些进程是本项目自己打开的问题。
  const 数据 = 读取JSON文件(进程登记文件路径, { processes: [] });
  return {
    processes: Array.isArray(数据.processes) ? 数据.processes : [],
  };
}

function 写入进程登记(processes) {
  // 这个函数解决进程登记文件统一落盘，避免多个模块各写各的。
  写入JSON文件(进程登记文件路径, {
    projectRoot: 项目根目录,
    updatedAt: new Date().toISOString(),
    processes,
  });
}

function 登记项目进程({ pid, role, label = '' }) {
  // 这个函数解决服务进程和浏览器进程的归属记录问题。
  const 标准PID = Number(pid);
  if (!Number.isInteger(标准PID) || 标准PID <= 0) return null;
  const 登记 = 读取进程登记();
  const 条目 = {
    pid: 标准PID,
    role: String(role || 'unknown'),
    label: String(label || ''),
    projectRoot: 项目根目录,
    registeredAt: new Date().toISOString(),
  };
  const 过滤后列表 = 登记.processes.filter((item) => {
    if (Number(item.pid) === 条目.pid) return false;
    if (条目.role === 'service' && item.role === 'service') return false;
    return true;
  });
  写入进程登记([...过滤后列表, 条目]);
  打印日志('进程登记', '进程登记表', `已登记 ${条目.role} PID=${条目.pid}`);
  return 条目;
}

function 取消登记项目进程(pid) {
  // 这个函数解决正常退出后把当前进程从登记表移除的问题。
  const 标准PID = Number(pid);
  const 登记 = 读取进程登记();
  写入进程登记(登记.processes.filter((item) => Number(item.pid) !== 标准PID));
}

function 进程仍存在(pid) {
  // 这个函数解决清理前先判断 PID 是否还活着的问题。
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'EINVAL') return false;
    return true;
  }
}

function 运行PowerShellJSON(script) {
  // 这个函数解决用 PowerShell 查询 Windows 进程时中文输出必须保持 UTF-8 的问题。
  if (process.platform !== 'win32') return null;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    cwd: 项目根目录,
    encoding: 'utf8',
    windowsHide: true,
  });
  const text = String(result.stdout || '').trim();
  if (!text) return null;
  return JSON.parse(text);
}

function 查询进程信息(pid) {
  // 这个函数解决只按 PID 清理前必须确认进程命令行归属的问题。
  const 标准PID = Number(pid);
  if (!Number.isInteger(标准PID) || 标准PID <= 0) return null;
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${标准PID}" -ErrorAction SilentlyContinue`,
    'if ($null -ne $p) { $p | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress }',
  ].join('; ');
  return 运行PowerShellJSON(script);
}

function 查询项目标记浏览器进程() {
  // 这个函数解决服务异常退出后仍能找到本项目标记过的浏览器主进程。
  const allowedNames = Array.from(浏览器进程名集合).map((name) => `'${name}'`).join(',');
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$allowed = @(${allowedNames})`,
    'Get-CimInstance Win32_Process | Where-Object {',
    `  $allowed -contains ([string]$_.Name).ToLower() -and ([string]$_.CommandLine).Contains('${项目标记参数名}')`,
    '} | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
  ].join('\n');
  const result = 运行PowerShellJSON(script);
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function 查询项目Node进程() {
  // 这个函数解决旧版下载中心留下的 Node 辅助脚本也能被启动清理收掉。
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$projectRoot = @'\n${项目根目录}\n'@.ToLower()`,
    'Get-CimInstance Win32_Process | Where-Object {',
    "  ([string]$_.Name).ToLower() -eq 'node.exe' -and ([string]$_.CommandLine).ToLower().Contains($projectRoot)",
    '} | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
  ].join('\n');
  const result = 运行PowerShellJSON(script);
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function 进程属于本项目(进程信息) {
  // 这个函数解决清理时只碰本项目进程，不误伤用户其它浏览器或 Node 程序。
  const commandLine = String(进程信息?.CommandLine || '').toLowerCase();
  if (!commandLine) return false;
  return commandLine.includes(项目根目录.toLowerCase())
    || commandLine.includes(项目标记参数名);
}

function 终止进程树(pid, reason = '') {
  // 这个函数解决退出时连同子进程一起结束，避免后台残留孤儿窗口。
  const 标准PID = Number(pid);
  if (!Number.isInteger(标准PID) || 标准PID <= 0) return false;
  if (!进程仍存在(标准PID)) return false;
  const result = spawnSync('taskkill.exe', ['/PID', String(标准PID), '/T', '/F'], {
    cwd: 项目根目录,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 && 进程仍存在(标准PID)) {
    throw new Error(`终止进程树失败 PID=${标准PID}：${String(result.stderr || result.stdout || '').trim()}`);
  }
  打印日志('后台清理', '进程树', `已终止 PID=${标准PID}${reason ? `，原因=${reason}` : ''}`);
  return true;
}

function 清理登记残留进程({ excludePids = [] } = {}) {
  // 这个函数解决启动时自动收掉上次异常遗留的服务和浏览器进程。
  const 排除集合 = new Set(excludePids.map((pid) => Number(pid)).filter(Boolean));
  const 登记 = 读取进程登记();
  const 保留列表 = [];
  const 已清理PID集合 = new Set();

  for (const 条目 of 登记.processes) {
    const pid = Number(条目.pid);
    if (!Number.isInteger(pid) || pid <= 0 || 排除集合.has(pid)) {
      保留列表.push(条目);
      continue;
    }
    if (!进程仍存在(pid)) continue;
    const 进程信息 = 查询进程信息(pid);
    if (进程属于本项目(进程信息)) {
      终止进程树(pid, `启动清理 ${条目.role || ''}`.trim());
      已清理PID集合.add(pid);
      continue;
    }
    保留列表.push(条目);
  }

  for (const 进程信息 of 查询项目标记浏览器进程()) {
    const pid = Number(进程信息.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0 || 排除集合.has(pid) || 已清理PID集合.has(pid)) continue;
    终止进程树(pid, '启动清理标记浏览器');
    已清理PID集合.add(pid);
  }

  for (const 进程信息 of 查询项目Node进程()) {
    const pid = Number(进程信息.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0 || 排除集合.has(pid) || 已清理PID集合.has(pid)) continue;
    终止进程树(pid, '启动清理项目 Node 残留');
    已清理PID集合.add(pid);
  }

  写入进程登记(保留列表.filter((item) => 进程仍存在(Number(item.pid))));
  if (已清理PID集合.size > 0) {
    打印日志('后台清理', '启动清理', `已清理 ${已清理PID集合.size} 个残留进程`);
  }
  return {
    cleanedPids: Array.from(已清理PID集合),
  };
}

function 构建浏览器归属启动参数() {
  // 这个函数解决本项目打开的浏览器在进程列表里有可识别标记。
  return [
    `${项目标记参数名}=${process.pid}`,
    `--invoice-download-center-project-root=${项目根目录}`,
  ];
}

module.exports = {
  项目标记参数名,
  读取进程登记,
  登记项目进程,
  取消登记项目进程,
  进程仍存在,
  查询进程信息,
  查询项目Node进程,
  进程属于本项目,
  终止进程树,
  清理登记残留进程,
  构建浏览器归属启动参数,
};
