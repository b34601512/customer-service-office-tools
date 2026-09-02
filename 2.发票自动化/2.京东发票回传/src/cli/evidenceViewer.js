const fs = require('fs');
const path = require('path');
const { 截图目录 } = require('../common/paths');
const {
  查找最近凭证批次目录,
  读取凭证目录状态,
} = require('../common/evidenceService');

const 共享打开文件夹模块路径 = [
  path.resolve(__dirname, '../../../共享CLI/打开文件夹.js'),
  path.resolve(__dirname, '../../共享CLI/打开文件夹.js'),
].find(fs.existsSync);
const {
  构建打开文件夹命令,
  打开文件夹,
} = require(共享打开文件夹模块路径);

async function 打开凭证目录(目录路径 = 截图目录, 选项 = {}) {
  const 目标目录 = 目录路径 === 截图目录
    ? 查找最近凭证批次目录()
    : 目录路径;
  return 打开文件夹(目标目录, {
    ...选项,
    文件夹名称: '凭证文件夹',
  });
}

function 读取最近凭证状态() {
  return 读取凭证目录状态(查找最近凭证批次目录());
}

module.exports = {
  构建打开文件夹命令,
  打开凭证目录,
  读取最近凭证状态,
};
