const { readPddPageBodyText } = require("../pddPageText");

const PDD_TAB_NAMES = {
  customer: "客服数据",
  afterSales: "售后数据",
  overall: "综合体验星级"
};

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function clickPddTab(page, tabName) {
  const clickedByDom = await page.evaluate((expectedTabName) => {
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const candidates = Array.from(document.querySelectorAll("a,button,[role='tab'],li,span,div"))
      .filter(isVisible)
      .filter((element) => normalizeText(element.innerText || element.textContent) === expectedTabName);
    const target = candidates.find((element) => element.matches("a,button,[role='tab'],li")) || candidates[0];
    if (!target) return false;
    target.click();
    return true;
  }, tabName).catch(() => false);
  if (clickedByDom) return true;

  const fallbackLocator = page.getByText(tabName, { exact: true }).first();
  if (await fallbackLocator.count().catch(() => 0) && await fallbackLocator.isVisible().catch(() => false)) {
    await fallbackLocator.click({ timeout: 5000 });
    return true;
  }
  throw new Error(`拼多多页面没有找到「${tabName}」标签。`);
}

function isPddMetricContentReady(pageType, pageText) {
  const normalizedText = String(pageText || "").replace(/\s+/g, " ").trim();
  if (pageType === "customer") {
    return /客服服务数据/.test(normalizedText) && /3分钟人工回复率\s*[\d.]+\s*%/.test(normalizedText);
  }
  if (pageType === "afterSales") {
    return /整体情况/.test(normalizedText) && /纠纷退款数\s*[\d.]+/.test(normalizedText);
  }
  if (pageType === "overall") {
    return /店铺综合体验星级/.test(normalizedText) &&
      /拼多多\s*App\s*显示\s*[\d.]+\s*星?/i.test(normalizedText);
  }
  return false;
}

async function waitForPddTabContent(page, pageType, timeoutMs = 30000) {
  const expectedTextByType = {
    customer: ["3分钟人工回复率", "平均人工响应时长", "客服数据"],
    afterSales: ["纠纷退款率", "品质退款率", "售后数据"],
    overall: ["店铺综合体验星级", "综合体验星级"]
  };
  const expectedTexts = expectedTextByType[pageType] || [];
  const deadline = Date.now() + timeoutMs;
  let latestText = "";
  while (Date.now() <= deadline) {
    latestText = await readPddPageBodyText(page).catch(() => "");
    if (expectedTexts.some((text) => latestText.includes(text)) &&
      isPddMetricContentReady(pageType, latestText)) return latestText;
    await wait(Math.min(500, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`拼多多「${PDD_TAB_NAMES[pageType] || pageType}」页面未出现指标内容：${latestText.slice(0, 120)}。`);
}

async function readPddMetricTabSnapshot(page, pageType, options = {}) {
  const tabName = PDD_TAB_NAMES[pageType];
  if (!tabName) throw new Error(`拼多多指标页类型无效：${pageType || "空"}。`);
  if (options.clickTab !== false) await clickPddTab(page, tabName);
  const pageText = await waitForPddTabContent(page, pageType, options.timeoutMs);
  return {
    pageType,
    pageText,
    sourceUrl: String(page.url() || "")
  };
}

module.exports = {
  PDD_TAB_NAMES,
  clickPddTab,
  isPddMetricContentReady,
  waitForPddTabContent,
  readPddMetricTabSnapshot
};
