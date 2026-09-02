const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { 下载目录 } = require('../common/paths');
const { 确保目录存在 } = require('../common/fs');

const 共享打开文件夹模块路径 = [
  path.resolve(__dirname, '../../../共享CLI/打开文件夹.js'),
  path.resolve(__dirname, '../../共享CLI/打开文件夹.js'),
].find(fs.existsSync);
const {
  构建打开文件夹命令: 构建共享打开文件夹命令,
  打开文件夹,
} = require(共享打开文件夹模块路径);

function 构建打开文件夹命令(folderPath, platform = process.platform) {
  // 这个函数保留下载中心旧接口，实际命令统一由共享引擎生成。
  const 共享命令 = 构建共享打开文件夹命令(folderPath, platform);
  return {
    command: 共享命令.程序,
    args: 共享命令.参数,
    options: 共享命令.选项,
  };
}

function 获取下载文件夹路径() {
  // 这个函数解决客服需要知道发票下载到哪里的问题。
  确保目录存在(下载目录);
  return 下载目录;
}

async function 打开下载文件夹({ spawnProcess = spawn, platform = process.platform } = {}) {
  // 这个函数解决命令行一键打开固定下载目录，避免用户手动找路径。
  const folderPath = 获取下载文件夹路径();
  return 打开文件夹(folderPath, {
    启动进程: spawnProcess,
    平台: platform,
    文件夹名称: '下载文件夹',
  });
}

module.exports = {
  构建打开文件夹命令,
  获取下载文件夹路径,
  打开下载文件夹,
};
