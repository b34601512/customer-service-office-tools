// 该文件用于解决天猫日期脚本执行后的页面结果验收问题。
const { getTmallCurrentDateLocator } = require("../tmallControls");
const {
  TMALL_DATE_PAGE_TIMEOUT_MS,
  TMALL_DATE_POLL_INTERVAL_MS
} = require("./tmallDateConstants");
const {
  buildExpectedDateText,
  isTmallDateRangeMatched,
  normalizeDateText,
  describeTmallDateText
} = require("./tmallDateText");

async function readCurrentTmallDateText(page) {
  // 这里读取页面主日期文本，作为唯一业务生效验收来源。
  const locator = getTmallCurrentDateLocator(page);
  return normalizeDateText(await locator.innerText());
}

async function waitForTmallPageDateApplied(page, range) {
  // 这里等待页面主日期文本命中目标区间，不靠固定等待猜测筛选是否生效。
  const expectedText = buildExpectedDateText(range);

  try {
    await page.waitForFunction(
      ({ startText, endText }) => {
        const normalizeDateText = (value) =>
          String(value || "")
            .replace(/\s+/g, "")
            .replace(/已选择[:：]/g, "")
            .replace(/至/g, "~")
            .replace(/～/g, "~")
            .trim();
        const normalizedText = normalizeDateText(
          document.querySelector(".oui-date-picker-current-date")?.textContent || ""
        );
        const match = normalizedText.match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);
        return Boolean(match && match[1] === startText && match[2] === endText);
      },
      {
        startText: range.startText,
        endText: range.endText
      },
      {
        timeout: TMALL_DATE_PAGE_TIMEOUT_MS,
        polling: TMALL_DATE_POLL_INTERVAL_MS
      }
    );
  } catch (_error) {
    const lastText = await readCurrentTmallDateText(page);
    throw new Error(`天猫页面日期验收失败：期望=${expectedText}，实际=${describeTmallDateText(lastText)}。`);
  }

  const appliedText = await readCurrentTmallDateText(page);
  if (!isTmallDateRangeMatched(appliedText, range)) {
    throw new Error(`天猫页面日期验收失败：期望=${expectedText}，实际=${describeTmallDateText(appliedText)}。`);
  }
  return appliedText;
}

module.exports = {
  waitForTmallPageDateApplied
};
