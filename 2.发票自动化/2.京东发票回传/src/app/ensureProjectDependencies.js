const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { 打印日志 } = require('../common/logger');

function 获取依赖标记路径(项目根目录) {
  // 解决：用依赖包自己的 package.json 作为安装完成的唯一真相，避免 node_modules 空壳误判。
  return path.join(项目根目录, 'node_modules', 'playwright', 'package.json');
}

function 获取Npm安装命令() {
  // 解决：当前 Windows/Node 组合直接 spawn npm.cmd 会返回 EINVAL，改走 cmd.exe 让首次启动稳定执行。
  if (process.platform === 'win32') {
    return {
      命令: 'cmd.exe',
      参数: ['/d', '/s', '/c', 'npm install'],
    };
  }

  return {
    命令: 'npm',
    参数: ['install'],
  };
}

function 确保项目依赖已就绪(项目根目录) {
  // 解决：只在缺依赖时安装一次，避免每次点击启动都重复跑 npm install。
  const 标记路径 = 获取依赖标记路径(项目根目录);
  if (fs.existsSync(标记路径)) {
    打印日志('依赖预检', '启动准备', `依赖已就绪：${path.relative(项目根目录, 标记路径)}`);
    return;
  }

  打印日志('依赖预检', '启动准备', '未检测到 Playwright，开始执行 npm install');
  const npm安装命令 = 获取Npm安装命令();
  const 安装结果 = spawnSync(npm安装命令.命令, npm安装命令.参数, {
    cwd: 项目根目录,
    stdio: 'inherit',
  });

  if (安装结果.error) {
    throw new Error(`项目依赖安装失败，无法启动 npm install，错误码=${安装结果.error.code ?? '未知'}，原因=${安装结果.error.message}。`);
  }

  if (安装结果.status !== 0) {
    throw new Error(`项目依赖安装失败，npm install 退出码=${安装结果.status ?? 'null'}。`);
  }

  if (!fs.existsSync(标记路径)) {
    throw new Error('项目依赖安装完成后仍未检测到 Playwright，请检查 npm 输出。');
  }

  打印日志('依赖预检', '启动准备', '项目依赖安装完成');
}

function main() {
  // 解决：让 bat 脚本和 Node 主程序都复用同一套依赖预检逻辑。
  const 项目根目录 = path.resolve(__dirname, '..', '..');
  确保项目依赖已就绪(项目根目录);
}

if (require.main === module) {
  try {
    main();
  } catch (错误) {
    打印日志('依赖失败', '启动准备', 错误.message);
    process.exit(1);
  }
}

module.exports = {
  获取Npm安装命令,
  确保项目依赖已就绪,
};
