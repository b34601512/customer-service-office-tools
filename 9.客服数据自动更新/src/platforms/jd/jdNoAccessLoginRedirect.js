// 该文件只负责把京东系统无权限页送回当前店铺的官方登录入口。
const { log } = require("../../engine/logger");
const { JD_SYSTEM_LOGIN_URL, isJdNoAccessUrl } = require("./jdUrlRules");

async function redirectJdNoAccessToLogin(page, storeConfig = {}) {
  // 这里发现无权限账号后直接显示登录页，让用户可以切换账号并沿 ReturnUrl 回到报表。
  if (!page || !isJdNoAccessUrl(page.url?.())) {
    return false;
  }

  const displayName = String(storeConfig.displayName || storeConfig.key || "当前店铺").trim();
  log(
    "主线:执行",
    "京东登录",
    "无权限切换账号",
    `店铺「${displayName}」当前账号没有客服管家权限，准备打开官方登录页`
  );
  await page.goto(JD_SYSTEM_LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await page.bringToFront();
  log(
    "主线:完成",
    "京东登录",
    "无权限切换账号",
    `店铺「${displayName}」已打开官方登录页，请完成登录后继续`
  );
  return true;
}

module.exports = {
  redirectJdNoAccessToLogin
};
