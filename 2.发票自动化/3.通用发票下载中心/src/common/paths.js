const path = require('path');

const 项目根目录 = path.resolve(__dirname, '..', '..');
const 数据目录 = path.join(项目根目录, 'data');
const 运行目录 = path.join(项目根目录, 'runtime');
const 下载目录 = path.join(运行目录, 'downloads');
const 截图目录 = path.join(运行目录, 'screenshots');
const 配置文件路径 = path.join(数据目录, 'invoice-system-config.json');
const 登录态文件路径 = path.join(数据目录, 'invoice-system-auth-state.json');
const 发票索引文件路径 = path.join(数据目录, 'invoice-file-index.json');
const 本次日志文件路径 = path.join(运行目录, 'latest-run.log');
const 进程登记文件路径 = path.join(运行目录, 'process-registry.json');
const 诺诺登录状态文件路径 = path.join(运行目录, 'nuonuo-login-status.json');

module.exports = {
  项目根目录,
  数据目录,
  运行目录,
  下载目录,
  截图目录,
  配置文件路径,
  登录态文件路径,
  发票索引文件路径,
  本次日志文件路径,
  进程登记文件路径,
  诺诺登录状态文件路径,
};
