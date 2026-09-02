// 该文件用于集中判断京东登录页和店铺后台地址。

function normalizeJdUrlText(value) {
  return String(value || "").trim();
}

function matchesJdUrl(url, hostPattern, pathPattern = null) {
  const safeUrl = normalizeJdUrlText(url);
  if (!safeUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(safeUrl);
    return hostPattern.test(parsedUrl.hostname) && (!pathPattern || pathPattern.test(parsedUrl.pathname));
  } catch (_error) {
    return hostPattern.test(safeUrl) && (!pathPattern || pathPattern.test(safeUrl));
  }
}

function isJdNewSystemUrl(url) {
  return matchesJdUrl(url, /^xi\.jd\.com$/i, /\/kf-manage-lite/i);
}

function isJdStoreBackendUrl(url) {
  return matchesJdUrl(
    url,
    /^(?:jdsz\.jd\.com|shop\.jd\.com|illegal-jdm\.shop\.jd\.com)$/i
  );
}

function buildJdShopLoginUrl(returnUrl) {
  return `https://passport.shop.jd.com/login/index.action/jdm?ReturnUrl=${encodeURIComponent(normalizeJdUrlText(returnUrl))}`;
}

function isJdNoAccessUrl(url) {
  // 这里精确识别京东系统无权限路由，只有该状态才需要引导用户切换账号。
  const safeUrl = normalizeJdUrlText(url);
  if (!isJdNewSystemUrl(safeUrl)) {
    return false;
  }

  try {
    return /^#\/NoAccess(?:$|[/?&])/i.test(new URL(safeUrl).hash);
  } catch (_error) {
    return /#\/NoAccess(?:$|[/?&])/i.test(safeUrl);
  }
}

module.exports = {
  isJdNewSystemUrl,
  isJdStoreBackendUrl,
  buildJdShopLoginUrl,
  isJdNoAccessUrl
};
