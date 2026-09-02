const fs = require('fs');
const path = require('path');
const { 数据目录, 运行目录, 店铺浏览器资料目录, 截图目录 } = require('./paths');

function 确保目录存在(目录路径) {
  // 解决：写文件前统一创建目录，避免每个模块重复判断。
  fs.mkdirSync(目录路径, { recursive: true });
}

function 初始化运行目录() {
  // 解决：主流程启动时一次性准备所有运行目录。
  [数据目录, 运行目录, 店铺浏览器资料目录, 截图目录].forEach(确保目录存在);
}

function 读取JSON文件(文件路径, 默认值) {
  // 解决：配置文件不存在时由调用方决定默认结构，不在读取层猜业务。
  if (!fs.existsSync(文件路径)) {
    return 默认值;
  }
  return JSON.parse(fs.readFileSync(文件路径, 'utf8'));
}

function 写入JSON文件(文件路径, 数据) {
  // 解决：JSON 落盘保持统一格式，方便人工排查配置。
  确保目录存在(path.dirname(文件路径));
  fs.writeFileSync(文件路径, JSON.stringify(数据, null, 2), 'utf8');
}

module.exports = {
  确保目录存在,
  初始化运行目录,
  读取JSON文件,
  写入JSON文件,
};
