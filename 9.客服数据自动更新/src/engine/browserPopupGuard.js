// 自动关闭仅限明确营销弹层和已知广告域名；登录、报表、下载新页默认保留。
const { dismissBlockingPopups } = require("../shared/blockingPopupEngine");
const AD_HOSTS = ["doubleclick.net", "googlesyndication.com", "googleadservices.com"];
const MARKETING_TEXTS = ["限时优惠", "立即开通", "立即体验", "广告推广", "营销活动", "新功能介绍"];
const PROTECTED_TEXTS = ["验证码", "安全验证", "身份验证", "重新登录", "确认导出", "导出范围", "下载任务", "选择店铺", "切换店铺", "支付", "授权", "删除"];
const installedBrowsers = new WeakSet();

function isKnownAdUrl(rawUrl) {
  try {
    const { hostname, protocol } = new URL(rawUrl);
    return ["https:", "http:"].includes(protocol) && AD_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`));
  } catch (_) { return false; }
}

function buildMarketingSelectors() {
  const roots = ["[role='dialog']", "[aria-modal='true']", "#msg_box_modal"];
  const exclude = PROTECTED_TEXTS.map(text => `:not(:has-text("${text}"))`).join("");
  return roots.flatMap(root => MARKETING_TEXTS.map(text => `${root}:has-text("${text}")${exclude}`));
}

async function installBrowserPopupGuard(browser, options = {}) {
  if (!browser || installedBrowsers.has(browser)) return;
  installedBrowsers.add(browser);
  const selectors = buildMarketingSelectors();
  const disposers = [];
  const installedPages = new WeakSet();
  const onWarning = options.onWarning || (() => {});
  function warn(error) { onWarning(String(error?.message || error)); }
  async function attachPage(page) {
    if (installedPages.has(page) || page.isClosed?.()) return;
    installedPages.add(page);
    const closeAdPage = async () => {
      if (!page.isClosed() && isKnownAdUrl(page.url())) await page.close();
    };
    const onNavigated = frame => {
      if (frame === page.mainFrame()) void closeAdPage().catch(warn);
    };
    page.on("framenavigated", onNavigated);
    disposers.push(() => page.off("framenavigated", onNavigated));
    await closeAdPage();
    if (page.isClosed()) return;
    if (typeof page.addLocatorHandler === "function") {
      const marketing = page.locator(selectors.map(selector => `${selector}:visible`).join(", ")).first();
      await page.addLocatorHandler(marketing, async () => {
        await dismissBlockingPopups(page, {
          platformName: "已知营销弹窗", dialogSelectors: selectors,
          popupIdleTimeoutMs: 0, maxPopups: 8, totalTimeoutMs: 15000
        });
      });
    }
  }
  const cleanup = () => {
    for (const dispose of disposers) dispose();
    installedBrowsers.delete(browser);
  };
  browser.once("disconnected", cleanup);
  try {
  for (const context of browser.contexts()) {
    const onPage = page => { void attachPage(page).catch(warn); };
    context.on("page", onPage);
    disposers.push(() => context.off("page", onPage));
    for (const page of context.pages()) {
      try { await attachPage(page); }
      catch (error) { if (!page.isClosed()) throw error; }
    }
  }
  } catch (error) {
    browser.off("disconnected", cleanup);
    cleanup();
    throw error;
  }
}

module.exports = { AD_HOSTS, MARKETING_TEXTS, PROTECTED_TEXTS, isKnownAdUrl, buildMarketingSelectors, installBrowserPopupGuard };
