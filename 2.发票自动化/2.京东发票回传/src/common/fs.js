const fs = require('fs');
const path = require('path');
const {
  数据目录,
  报告目录,
  运行目录,
  截图目录,
  店铺浏览器目录,
  店铺登录态目录,
  店铺快照目录,
} = require('./paths');

function 确保目录存在(目录路径) {
  // 解决：在写入文件之前保证目录已经存在，避免运行时因路径缺失中断。
  fs.mkdirSync(目录路径, { recursive: true });
}

function 初始化运行目录() {
  // 解决：集中初始化项目需要的运行目录，减少主流程里的样板代码。
  [数据目录, 报告目录, 运行目录, 截图目录, 店铺浏览器目录, 店铺登录态目录, 店铺快照目录].forEach(确保目录存在);
}

function 读取JSON文件(文件路径, 默认值) {
  // 解决：读取快照和配置时统一处理 UTF-8 与不存在文件的情况。
  if (!fs.existsSync(文件路径)) {
    return 默认值;
  }

  const 原始内容 = fs.readFileSync(文件路径, 'utf8');
  return JSON.parse(原始内容);
}

function 写入JSON文件(文件路径, 数据) {
  // 解决：统一将对象用 UTF-8 JSON 方式落盘，便于后续追踪与比对。
  确保目录存在(path.dirname(文件路径));
  fs.writeFileSync(文件路径, JSON.stringify(数据, null, 2), 'utf8');
}

function 写入文本文件(文件路径, 文本) {
  // 解决：报告落盘前统一保证目录存在并保持 UTF-8 编码。
  确保目录存在(path.dirname(文件路径));
  fs.writeFileSync(文件路径, 文本, 'utf8');
}

module.exports = {
  初始化运行目录,
  读取JSON文件,
  写入JSON文件,
  写入文本文件,
};
