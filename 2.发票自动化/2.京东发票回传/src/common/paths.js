const path = require('path');

const 项目根目录 = path.resolve(__dirname, '..', '..');
const 数据目录 = path.join(项目根目录, 'data');
const 报告目录 = path.join(数据目录, 'reports');
const 运行目录 = path.join(项目根目录, 'runtime');
const 截图目录 = path.join(运行目录, 'screenshots');
const 店铺浏览器目录 = path.join(运行目录, 'store-profiles');
const 店铺登录态目录 = path.join(数据目录, 'store-auth-states');
const 店铺快照目录 = path.join(数据目录, 'store-snapshots');
const 店铺配置文件路径 = path.join(数据目录, 'stores.json');
const 店铺结果文件路径 = path.join(数据目录, 'store-results.json');
const 催票订单记录文件路径 = path.join(数据目录, 'invoice-urge-orders.json');
const 本次日志文件路径 = path.join(运行目录, 'latest-run.log');
const 诊断日志文件路径 = path.join(运行目录, 'latest-diagnostic.log');

function 获取当前硬盘备份目录(rootDirectory = 项目根目录) {
  // 解决：所有归档和清理都进入当前硬盘根目录的备份区，避免硬删除后无法追溯。
  const 硬盘根目录 = path.parse(path.resolve(rootDirectory)).root;
  return path.join(硬盘根目录, '备份文件夹');
}

function 规范化店铺标识(店铺标识) {
  // 解决：把任意店铺名称转换成稳定文件名，避免中文和特殊字符把路径搞坏。
  return String(店铺标识 || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || '';
}

function 获取店铺浏览器目录(店铺标识) {
  // 解决：定位旧版店铺浏览器档案，便于一次性迁移和备份。
  const 标准标识 = 规范化店铺标识(店铺标识);
  if (!标准标识) {
    throw new Error('获取店铺浏览器目录失败：店铺标识不能为空。');
  }
  return path.join(店铺浏览器目录, 标准标识);
}

function 获取店铺登录态文件路径(店铺标识) {
  // 解决：每个店铺只长期保存一份最小登录态文件，避免完整浏览器档案膨胀。
  const 标准标识 = 规范化店铺标识(店铺标识);
  if (!标准标识) {
    throw new Error('获取店铺登录态路径失败：店铺标识不能为空。');
  }
  return path.join(店铺登录态目录, `${标准标识}.json`);
}

function 获取店铺快照文件路径(店铺标识) {
  // 解决：为每个店铺单独保存巡检快照，保证新增记录比较基于各自历史。
  const 标准标识 = 规范化店铺标识(店铺标识);
  if (!标准标识) {
    throw new Error('获取店铺快照路径失败：店铺标识不能为空。');
  }
  return path.join(店铺快照目录, `${标准标识}.json`);
}

module.exports = {
  项目根目录,
  数据目录,
  报告目录,
  运行目录,
  截图目录,
  店铺浏览器目录,
  店铺登录态目录,
  店铺快照目录,
  店铺配置文件路径,
  店铺结果文件路径,
  催票订单记录文件路径,
  本次日志文件路径,
  诊断日志文件路径,
  获取当前硬盘备份目录,
  规范化店铺标识,
  获取店铺浏览器目录,
  获取店铺登录态文件路径,
  获取店铺快照文件路径,
};
