// 该文件只负责把已验店的抖音页面稳定导航到客服数据地址。
const DOUYIN_NAVIGATION_ATTEMPTS = 3;

function isAbortedNavigationError(error) {
  // 抖音单页应用在自身重定向时会中断 Playwright 的导航请求，这类错误允许有限重试。
  return /net::ERR_ABORTED/i.test(String(error?.message || error || ""));
}

function isCurrentPageAtTarget(page, targetUrl) {
  // 忽略 hash，确认浏览器实际上是否已经落到目标页面。
  const currentUrl = String(page?.url?.() || "").split("#")[0];
  const normalizedTargetUrl = String(targetUrl || "").split("#")[0];
  return Boolean(normalizedTargetUrl && currentUrl.startsWith(normalizedTargetUrl));
}

async function navigateDouyinDataPage(page, targetUrl, options = {}) {
  // 只对真实采集到的 ERR_ABORTED 做有限重试，其他导航错误保持原样抛出。
  const waitFn = options.waitFn || ((milliseconds) => page.waitForTimeout(milliseconds));
  const attempts = Number(options.attempts) || DOUYIN_NAVIGATION_ATTEMPTS;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (error) {
      if (!isAbortedNavigationError(error)) {
        throw error;
      }
      if (isCurrentPageAtTarget(page, targetUrl)) {
        return;
      }
      lastError = error;
      if (attempt < attempts) {
        await waitFn(800);
      }
    }
  }

  throw new Error(`抖音客服数据页连续 ${attempts} 次被页面重定向中断：${lastError?.message || "ERR_ABORTED"}`);
}

module.exports = {
  navigateDouyinDataPage,
  isAbortedNavigationError,
  isCurrentPageAtTarget
};
