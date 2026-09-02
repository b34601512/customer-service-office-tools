const fs = require('fs');
const path = require('path');
const { 打印日志 } = require('../../common/logger');

async function 保存店铺浏览器登录态(context, 登录态文件路径) {
  // 解决：登录确认后只保存 cookies、localStorage 和 IndexedDB，不保存完整浏览器档案。
  fs.mkdirSync(path.dirname(登录态文件路径), { recursive: true });
  await context.storageState({
    path: 登录态文件路径,
    indexedDB: true,
  });
  打印日志('登录态保存', '店铺浏览器', `已保存最小登录态：${登录态文件路径}`);
  return 登录态文件路径;
}

module.exports = {
  保存店铺浏览器登录态,
};
