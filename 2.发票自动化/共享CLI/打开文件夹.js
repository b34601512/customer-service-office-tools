const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function 构建打开文件夹命令(目录路径, 平台 = process.platform) {
  if (平台 === 'win32') {
    return {
      程序: 'explorer.exe',
      参数: ['/n,', 目录路径],
      选项: {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      },
    };
  }

  return {
    程序: 平台 === 'darwin' ? 'open' : 'xdg-open',
    参数: [目录路径],
    选项: {
      detached: true,
      stdio: 'ignore',
    },
  };
}

function 等待文件夹打开进程启动(打开进程, 文件夹名称, 超时毫秒 = 3000) {
  return new Promise((resolve, reject) => {
    if (typeof 打开进程?.once !== 'function') {
      resolve();
      return;
    }

    let 定时器;
    const 清理监听 = () => {
      clearTimeout(定时器);
      打开进程.off?.('spawn', 处理启动);
      打开进程.off?.('error', 处理错误);
    };
    const 处理启动 = () => {
      清理监听();
      resolve();
    };
    const 处理错误 = (错误) => {
      清理监听();
      reject(new Error(`打开${文件夹名称}失败：${错误.message}`));
    };

    定时器 = setTimeout(() => {
      清理监听();
      reject(new Error(`打开${文件夹名称}超时：系统没有确认资源管理器已启动。`));
    }, 超时毫秒);
    打开进程.once('spawn', 处理启动);
    打开进程.once('error', 处理错误);
  });
}

async function 打开文件夹(目录路径, {
  启动进程 = childProcess.spawn,
  平台 = process.platform,
  文件夹名称 = '文件夹',
} = {}) {
  const 可打开目录路径 = path.resolve(目录路径);
  fs.mkdirSync(可打开目录路径, { recursive: true });
  const 打开文件夹命令 = 构建打开文件夹命令(可打开目录路径, 平台);
  const 打开进程 = 启动进程(
    打开文件夹命令.程序,
    打开文件夹命令.参数,
    打开文件夹命令.选项,
  );
  await 等待文件夹打开进程启动(打开进程, 文件夹名称);
  打开进程.unref?.();
  return 可打开目录路径;
}

module.exports = {
  构建打开文件夹命令,
  打开文件夹,
};
