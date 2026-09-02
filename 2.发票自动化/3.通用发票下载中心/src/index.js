const { 读取发票系统配置, 保存发票系统配置 } = require('./config/invoiceSystemConfig');
const { 导入旧京东发票系统配置 } = require('./config/legacyJdConfigImporter');
const { 验证诺诺登录 } = require('./nuonuo/loginVerifier');
const { 批量下载发票 } = require('./nuonuo/invoiceDownloader');
const { 查找本地发票, 登记本地发票文件, 列出本地发票 } = require('./invoices/invoiceFileStore');
const { 批量下载发票文件 } = require('./client/downloadCenterClient');

module.exports = {
  读取发票系统配置,
  保存发票系统配置,
  导入旧京东发票系统配置,
  验证诺诺登录,
  批量下载发票,
  查找本地发票,
  登记本地发票文件,
  列出本地发票,
  批量下载发票文件,
};
