// 该文件用于统一关闭下班监控页。
const { log } = require("../../../engine/logger");

async function closeOffDutyPage(page, reason) {
  // 这里统一释放下班监控页，避免下班监控停用或出错后继续占用浏览器资源。
  if (!page) {
    return null;
  }

  await page.close().catch(() => {});
  if (reason) {
    log("主线:完成", "下班监控", "关闭交接页", reason);
  }
  return null;
}

module.exports = {
  closeOffDutyPage
};
