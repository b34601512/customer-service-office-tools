const { runAfterDismissingJdPopups } = require("../jdPopupAndSurfaceState");
const { escapeRegExp } = require("../../../shared/escapeRegExp");

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readJdMetricPageText(page) {
  const textParts = [];
  for (const frame of page.frames()) {
    try {
      const bodyLocator = frame.locator("body");
      const [visibleText, documentText] = await Promise.all([
        bodyLocator.innerText({ timeout: 3000 }).catch(() => ""),
        bodyLocator.textContent({ timeout: 3000 }).catch(() => "")
      ]);
      if (normalizeWhitespace(visibleText)) textParts.push(visibleText);
      if (normalizeWhitespace(documentText)) textParts.push(documentText);
    } catch (_error) {
      // 单个 frame 正在切换时继续读取其余可见区域。
    }
  }
  return [...new Set(textParts)].join("\n");
}

async function waitForJdMetricPageText(page, requiredTextList, timeoutMilliseconds = 60000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let latestPageText = "";
  while (Date.now() <= deadline) {
    latestPageText = await readJdMetricPageText(page);
    if (requiredTextList.some((requiredText) => latestPageText.includes(requiredText))) {
      return latestPageText;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`京东页面未出现目标指标：${requiredTextList.join("、")}。当前页面=${page.url()}`);
}

async function waitForVisibleJdMetricCardText(page, requiredTextList, timeoutMilliseconds = 60000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() <= deadline) {
    for (const requiredText of requiredTextList) {
      const matchingElements = page.getByText(requiredText, { exact: false });
      const matchingCount = await matchingElements.count().catch(() => 0);
      for (let elementIndex = 0; elementIndex < matchingCount; elementIndex += 1) {
        if (await matchingElements.nth(elementIndex).isVisible().catch(() => false)) {
          return await page.locator("body").innerText({ timeout: 5000 });
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`京东页面未出现可见指标卡：${requiredTextList.join("、")}。当前页面=${page.url()}`);
}

async function clickVisibleJdMetricTab(page, tabText) {
  const exactTab = page.locator(".jmtd-tabs-tab").filter({ hasText: new RegExp(`^${escapeRegExp(tabText)}$`) });
  const tabCount = await exactTab.count();
  for (let tabIndex = tabCount - 1; tabIndex >= 0; tabIndex -= 1) {
    const candidate = exactTab.nth(tabIndex);
    if (await candidate.isVisible().catch(() => false)) {
      await runAfterDismissingJdPopups(page, () => candidate.click({ timeout: 10000 }));
      return;
    }
  }
  throw new Error(`京东页面没有找到可点击标签「${tabText}」。`);
}

function parseStatisticsDateRange(pageText) {
  const normalizedText = normalizeWhitespace(pageText);
  const rangeMatch = normalizedText.match(/当前统计\s*(\d{4}-\d{2}-\d{2})\s*至\s*(\d{4}-\d{2}-\d{2})\s*期间数据/);
  if (!rangeMatch) {
    throw new Error("京东指标页面没有读到真实统计开始日和结束日。");
  }
  return { startDate: rangeMatch[1], endDate: rangeMatch[2] };
}

function parseNumericText(valueText) {
  const numericValue = Number(String(valueText || "").replace(/,/g, ""));
  return Number.isFinite(numericValue) ? numericValue : null;
}

function extractMetricFromText(pageText, metricLabel, unitPattern) {
  const normalizedText = normalizeWhitespace(pageText);
  const metricPattern = new RegExp(
    `${escapeRegExp(metricLabel)}\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(?:${unitPattern})`,
    "i"
  );
  const metricMatch = normalizedText.match(metricPattern);
  return metricMatch ? parseNumericText(metricMatch[1]) : null;
}

async function readMetricFromNearbyElement(page, metricLabel, unitPattern) {
  return page.evaluate(({ label, unitSource }) => {
    const unitExpression = new RegExp(`([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(?:${unitSource})`, "i");
    const allElements = Array.from(document.querySelectorAll("body *"));
    const labelElements = allElements.filter((element) =>
      String(element.textContent || "").replace(/\s+/g, " ").trim() === label &&
      Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
    );
    const candidateTexts = [];
    for (const labelElement of labelElements) {
      let currentElement = labelElement;
      for (let ancestorDepth = 0; ancestorDepth <= 7 && currentElement; ancestorDepth += 1) {
        const candidateText = String(currentElement.innerText || currentElement.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        if (candidateText.includes(label) && unitExpression.test(candidateText)) {
          candidateTexts.push(candidateText);
        }
        currentElement = currentElement.parentElement;
      }
    }
    candidateTexts.sort((leftText, rightText) => leftText.length - rightText.length);
    for (const candidateText of candidateTexts) {
      const labelOffset = candidateText.indexOf(label);
      const trailingText = candidateText.slice(labelOffset + label.length);
      const match = trailingText.match(unitExpression);
      if (match) return Number(match[1].replace(/,/g, ""));
    }
    return null;
  }, { label: metricLabel, unitSource: unitPattern });
}

// 读取单个指标数值；页面没有该指标或数值为「—」等情况时返回 null，由收集器决定跳过该项，
// 而不是把整店判失败。页面结构类错误仍由 waitForJdMetricPageText / waitForVisibleJdMetricCardText
// / clickVisibleJdMetricTab / parseStatisticsDateRange 抛错。
async function readMetricValue(page, pageText, metricLabel, unitPattern) {
  const textValue = extractMetricFromText(pageText, metricLabel, unitPattern);
  if (textValue !== null) return textValue;
  return readMetricFromNearbyElement(page, metricLabel, unitPattern);
}

module.exports = {
  normalizeWhitespace,
  readJdMetricPageText,
  waitForJdMetricPageText,
  waitForVisibleJdMetricCardText,
  clickVisibleJdMetricTab,
  parseStatisticsDateRange,
  extractMetricFromText,
  readMetricValue
};
