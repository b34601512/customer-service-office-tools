const fs = require('fs');
const path = require('path');
const { 数据目录, 运行目录, 下载目录, 截图目录 } = require('./paths');

function 确保目录存在(目录路径) {
  // 这个函数解决写文件前目录不存在导致程序中断的问题。
  fs.mkdirSync(目录路径, { recursive: true });
}

function 初始化运行目录() {
  // 这个函数解决项目启动时基础目录未准备好的问题。
  [数据目录, 运行目录, 下载目录, 截图目录].forEach(确保目录存在);
}

function 读取JSON文件(文件路径, 默认值) {
  // 这个函数解决配置文件不存在时仍能稳定返回默认配置。
  if (!fs.existsSync(文件路径)) return 默认值;
  return JSON.parse(fs.readFileSync(文件路径, 'utf8'));
}

function 写入JSON文件(文件路径, 数据) {
  // 这个函数解决 JSON 文件统一用 UTF-8 落盘的问题。
  确保目录存在(path.dirname(文件路径));
  fs.writeFileSync(文件路径, JSON.stringify(数据, null, 2), 'utf8');
}

module.exports = {
  确保目录存在,
  初始化运行目录,
  读取JSON文件,
  写入JSON文件,
};
