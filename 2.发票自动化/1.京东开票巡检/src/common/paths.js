const path = require('path');

const 项目根目录 = path.resolve(__dirname, '..', '..');
const 数据目录 = path.join(项目根目录, 'data');
const 报告目录 = path.join(数据目录, 'reports');
const 运行目录 = path.join(项目根目录, 'runtime');
const 浏览器目录 = path.join(运行目录, 'edge-profile');
const 店铺浏览器目录 = path.join(运行目录, 'store-profiles');
const 店铺快照目录 = path.join(数据目录, 'store-snapshots');
const 店铺配置文件路径 = path.join(数据目录, 'stores.json');
const 店铺结果文件路径 = path.join(数据目录, 'store-results.json');
const 发票处理状态文件路径 = path.join(数据目录, 'invoice-order-state.json');
const 快照文件路径 = path.join(数据目录, 'latest-invoices.json');

function 规范化店铺标识(店铺标识) {
  // 解决：把任意店铺名称转换成稳定文件名，避免中文和特殊字符把路径搞坏。
  return String(店铺标识 || 'default')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'default';
}

function 获取店铺浏览器目录(店铺标识) {
  // 解决：给每个店铺分配独立浏览器档案，避免多账号登录态互相污染。
  const 标准标识 = 规范化店铺标识(店铺标识);
  if (标准标识 === 'default' || 标准标识 === 'default-store') {
    return 浏览器目录;
  }
  return path.join(店铺浏览器目录, 标准标识);
}

function 获取店铺快照文件路径(店铺标识) {
  // 解决：为每个店铺单独保存巡检快照，保证新增记录比较基于各自历史。
  return path.join(店铺快照目录, `${规范化店铺标识(店铺标识)}.json`);
}

module.exports = {
  项目根目录,
  数据目录,
  报告目录,
  运行目录,
  浏览器目录,
  店铺浏览器目录,
  店铺快照目录,
  店铺配置文件路径,
  店铺结果文件路径,
  发票处理状态文件路径,
  快照文件路径,
  规范化店铺标识,
  获取店铺浏览器目录,
  获取店铺快照文件路径,
};
