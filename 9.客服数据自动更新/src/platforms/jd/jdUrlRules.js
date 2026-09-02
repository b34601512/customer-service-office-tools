// 该文件用于集中管理京东业务入口地址，避免旧系统地址和新后台地址混在各模块里。
const JD_SYSTEM_RECEPTION_DATA_URL = "https://xi.jd.com/kf-manage-lite/#/DataAnalysis/ReceptionData";
const JD_SYSTEM_LOGIN_URL = `https://passport.jd.com/new/login.aspx?ReturnUrl=${encodeURIComponent(JD_SYSTEM_RECEPTION_DATA_URL)}`;

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

function isJdSystemReceptionDataUrl(url) {
  // 这里必须精确到 ReceptionData 路由，避免出勤页等相邻页面被当成客服数据页继续导出。
  const safeUrl = normalizeJdUrlText(url);
  if (!isJdNewSystemUrl(safeUrl)) {
    return false;
  }

  try {
    const parsedUrl = new URL(safeUrl);
    return /#\/DataAnalysis\/ReceptionData(?:$|[/?&])/i.test(parsedUrl.hash);
  } catch (_error) {
    return /#\/DataAnalysis\/ReceptionData(?:$|[/?&])/i.test(safeUrl);
  }
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
  JD_SYSTEM_RECEPTION_DATA_URL,
  JD_SYSTEM_LOGIN_URL,
  isJdNewSystemUrl,
  isJdSystemReceptionDataUrl,
  isJdNoAccessUrl
};
