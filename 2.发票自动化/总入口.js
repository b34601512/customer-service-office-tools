const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const {
  总入口版本,
  构建应用展示信息,
  格式化应用展示信息,
} = require('./共享CLI/应用元信息');

const 总目录路径 = __dirname;
const 总入口标题 = '发票自动化总控制台';
const 总入口应用展示信息 = 构建应用展示信息({
  应用名称: 总入口标题,
  显示版本: 总入口版本,
});
const 子项目定义列表 = [
  { 菜单编号: '1', 项目名称: '京东开票巡检', 项目目录名称: '1.京东开票巡检', 启动文件名称: '启动巡检.bat' },
  { 菜单编号: '2', 项目名称: '京东发票回传', 项目目录名称: '2.京东发票回传', 启动文件名称: '启动催票后台.bat' },
  { 菜单编号: '3', 项目名称: '天猫发票回传', 项目目录名称: '4.天猫发票回传', 启动文件名称: '启动天猫登录.bat' },
  { 菜单编号: '4', 项目名称: '拼多多发票回传', 项目目录名称: '5.拼多多发票回传', 启动文件名称: '启动拼多多后台.bat' },
  { 菜单编号: '5', 项目名称: '抖音发票回传', 项目目录名称: '6.抖音发票回传', 启动文件名称: '启动抖音后台.bat' },
];

const 终端颜色 = {
  标题: '\x1b[36m',
  强调: '\x1b[93m',
  成功: '\x1b[92m',
  失败: '\x1b[91m',
  弱化: '\x1b[90m',
  重置: '\x1b[0m',
};

function 着色文本(文本, 颜色名称, 输出流 = process.stdout) {
  if (!输出流?.isTTY || !终端颜色[颜色名称]) return String(文本);
  return `${终端颜色[颜色名称]}${文本}${终端颜色.重置}`;
}

function 清屏(输出流 = process.stdout) {
  if (输出流?.isTTY) 输出流.write('\x1b[2J\x1b[H');
}

function 构建子项目路径(子项目定义, 总目录 = 总目录路径) {
  const 项目目录路径 = path.join(总目录, 子项目定义.项目目录名称);
  return {
    项目目录路径,
    启动文件路径: path.join(项目目录路径, 子项目定义.启动文件名称),
    子项目窗口标题: `发票自动化-${子项目定义.项目名称}`,
  };
}

function 查找子项目定义(菜单选择, 项目定义集合 = 子项目定义列表) {
  const 标准菜单选择 = String(菜单选择 || '').trim();
  return 项目定义集合.find((子项目定义) => 子项目定义.菜单编号 === 标准菜单选择) || null;
}

function 检查子项目入口(子项目定义, { 总目录 = 总目录路径, fileExists = fs.existsSync } = {}) {
  const 子项目路径 = 构建子项目路径(子项目定义, 总目录);
  if (!fileExists(子项目路径.项目目录路径)) {
    return { ok: false, message: `没有找到子项目目录：${子项目路径.项目目录路径}`, ...子项目路径 };
  }
  if (!fileExists(子项目路径.启动文件路径)) {
    return { ok: false, message: `没有找到子项目启动文件：${子项目路径.启动文件路径}`, ...子项目路径 };
  }
  return { ok: true, ...子项目路径 };
}

function 构建Windows命令参数(命令参数) {
  return `"${String(命令参数).replace(/"/g, '""')}"`;
}

function 构建子项目窗口启动命令({ 项目目录路径, 启动文件路径, 子项目窗口标题 }) {
  return [
    'start',
    构建Windows命令参数(子项目窗口标题),
    '/max',
    '/d',
    构建Windows命令参数(项目目录路径),
    'cmd.exe',
    '/d',
    '/c',
    'call',
    构建Windows命令参数(启动文件路径),
    '--launcher-maximized',
  ].join(' ');
}

function 构建子项目窗口启动选项(总目录 = 总目录路径) {
  return {
    cwd: 总目录,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    windowsVerbatimArguments: true,
  };
}

function 默认启动子项目窗口({ 项目目录路径, 启动文件路径, 子项目窗口标题 }) {
  const 子项目窗口启动命令 = 构建子项目窗口启动命令({
    项目目录路径,
    启动文件路径,
    子项目窗口标题,
  });
  const 子项目进程 = spawn('cmd.exe', [
    '/d',
    '/s',
    '/c',
    子项目窗口启动命令,
  ], 构建子项目窗口启动选项());
  子项目进程.unref();
  return 子项目进程;
}

function 启动子项目(子项目定义, {
  总目录 = 总目录路径,
  fileExists = fs.existsSync,
  launchProjectWindow = 默认启动子项目窗口,
} = {}) {
  const 入口检查结果 = 检查子项目入口(子项目定义, { 总目录, fileExists });
  if (!入口检查结果.ok) throw new Error(入口检查结果.message);
  launchProjectWindow(入口检查结果);
  return 入口检查结果;
}

function 输出主菜单(输出函数, 输出流 = process.stdout) {
  清屏(输出流);
  输出函数着色(输出函数, 总入口标题, '标题', 输出流);
  输出函数着色(输出函数, '按需选择一个现有子项目启动；子项目会在独立窗口运行。', '弱化', 输出流);
  输出函数着色(输出函数, 格式化应用展示信息(总入口应用展示信息), '弱化', 输出流);
  输出函数着色(输出函数, '────────────────────────────────────────────────────────', '弱化', 输出流);
  子项目定义列表.forEach((子项目定义) => {
    输出函数着色(输出函数, `  [${子项目定义.菜单编号}] ${子项目定义.项目名称}`, '强调', 输出流);
  });
  输出函数着色(输出函数, '  [0] 退出', '强调', 输出流);
  输出函数着色(输出函数, '────────────────────────────────────────────────────────', '弱化', 输出流);
}

function 输出函数着色(输出函数, 文本, 颜色名称, 输出流) {
  输出函数(着色文本(文本, 颜色名称, 输出流));
}

function 创建命令行提问器(输入流, 输出流) {
  const 读取器 = readline.createInterface({ input: 输入流, output: 输出流 });
  return {
    询问: (问题) => new Promise((resolve) => 读取器.question(问题, resolve)),
    关闭: () => 读取器.close(),
  };
}

async function 启动总入口({
  input = process.stdin,
  output = (消息) => console.log(消息),
  outputStream = process.stdout,
  launchProjectWindow = 默认启动子项目窗口,
} = {}) {
  const 命令行提问器 = 创建命令行提问器(input, outputStream);
  let 是否请求退出 = false;
  const 处理退出信号 = () => {
    是否请求退出 = true;
    命令行提问器.关闭();
  };
  process.once('SIGINT', 处理退出信号);
  process.once('SIGBREAK', 处理退出信号);

  try {
    while (!是否请求退出) {
      输出主菜单(output, outputStream);
      const 菜单选择 = (await 命令行提问器.询问('请选择：')).trim();
      if (菜单选择 === '0') break;

      const 子项目定义 = 查找子项目定义(菜单选择);
      if (!子项目定义) {
        output(着色文本('[提示] 无效选项。', '失败', outputStream));
        await 命令行提问器.询问('按回车返回总菜单……');
        continue;
      }

      try {
        启动子项目(子项目定义, { launchProjectWindow });
        output(着色文本(`[已启动] ${子项目定义.项目名称}`, '成功', outputStream));
      } catch (error) {
        output(着色文本(`[失败] ${error.message}`, '失败', outputStream));
      }
      await 命令行提问器.询问('按回车返回总菜单……');
    }
  } finally {
    process.off('SIGINT', 处理退出信号);
    process.off('SIGBREAK', 处理退出信号);
    命令行提问器.关闭();
  }
}

if (require.main === module) {
  启动总入口().catch((error) => {
    console.error(`[错误] 总入口启动失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  总入口应用展示信息,
  子项目定义列表,
  构建子项目路径,
  构建Windows命令参数,
  构建子项目窗口启动命令,
  构建子项目窗口启动选项,
  查找子项目定义,
  检查子项目入口,
  启动子项目,
  输出主菜单,
  启动总入口,
};
