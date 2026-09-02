const { 导入旧京东发票系统配置 } = require('../config/legacyJdConfigImporter');
const { 打印日志 } = require('../common/logger');

function main() {
  // 这个函数解决命令行一键把旧京东项目里的诺诺配置迁移到下载中心。
  const result = 导入旧京东发票系统配置();
  打印日志('配置迁移', '旧京东项目', result.config.hasUsername ? '已导入诺诺账号' : '未导入诺诺账号');
  打印日志('配置迁移', '旧京东项目', result.copiedAuthState ? '已复制诺诺登录态' : '旧项目没有诺诺登录态可复制');
}

if (require.main === module) {
  main();
}
