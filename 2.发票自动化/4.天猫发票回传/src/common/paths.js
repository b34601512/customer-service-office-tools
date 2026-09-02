const path = require('path');

const 项目根目录 = path.resolve(__dirname, '..', '..');
const 数据目录 = path.join(项目根目录, 'data');
const 运行目录 = path.join(项目根目录, 'runtime');
const 店铺浏览器资料目录 = path.join(运行目录, 'store-profiles');
const 截图目录 = path.join(运行目录, 'screenshots');
const 天猫导出目录 = path.join(运行目录, 'tmall-exports');
const 全流程临时目录 = path.join(运行目录, 'full-flow');
const 店铺配置文件路径 = path.join(数据目录, 'stores.json');
const 本次日志文件路径 = path.join(运行目录, 'latest-run.log');
const 诊断日志文件路径 = path.join(运行目录, 'latest-diagnostic.log');

function 获取当前硬盘备份目录(rootDirectory = 项目根目录) {
  // 解决：所有旧设计归档进入当前硬盘根目录备份区，避免误删后不可追溯。
  const 硬盘根目录 = path.parse(path.resolve(rootDirectory)).root;
  return path.join(硬盘根目录, '备份文件夹');
}

function 规范化店铺标识(店铺标识) {
  // 解决：店铺标识会进入文件路径，必须去掉 Windows 不允许的字符。
  return String(店铺标识 || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = {
  项目根目录,
  数据目录,
  运行目录,
  店铺浏览器资料目录,
  截图目录,
  天猫导出目录,
  全流程临时目录,
  店铺配置文件路径,
  本次日志文件路径,
  诊断日志文件路径,
  获取当前硬盘备份目录,
  规范化店铺标识,
};
