const fs = require('fs');
const path = require('path');
const { 截图目录 } = require('../common/paths');

const 共享打开文件夹模块路径 = [
  path.resolve(__dirname, '../../../共享CLI/打开文件夹.js'),
  path.resolve(__dirname, '../../共享CLI/打开文件夹.js'),
].find(fs.existsSync);
if (!共享打开文件夹模块路径) throw new Error('找不到共享打开文件夹模块。');

const {
  构建打开文件夹命令,
  打开文件夹,
} = require(共享打开文件夹模块路径);

async function 打开凭证目录(目录路径 = 截图目录, 选项 = {}) {
  return 打开文件夹(目录路径, {
    ...选项,
    文件夹名称: '凭证文件夹',
  });
}

module.exports = {
  构建打开文件夹命令,
  打开凭证目录,
};
