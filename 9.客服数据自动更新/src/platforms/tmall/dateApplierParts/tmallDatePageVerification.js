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
  // 这里读取页面主日期文本，作为唯一业务生效验收来源；元素未出现时按空文本继续轮询。
  const locator = getTmallCurrentDateLocator(page);
  if (!(await locator.isVisible().catch(() => false))) {
    return "";
  }
  return normalizeDateText(await locator.innerText().catch(() => ""));
}

async function waitForTmallPageDateApplied(page, range) {
  // 这里只在节点侧轮询页面文本，命中规则统一收口到 tmallDateText 单一真源，
  // 不再在页内脚本复制一份归一化和匹配逻辑，避免双真源漂移。
  const expectedText = buildExpectedDateText(range);
  const deadline = Date.now() + TMALL_DATE_PAGE_TIMEOUT_MS;
  let lastText = "";
  while (Date.now() <= deadline) {
    lastText = await readCurrentTmallDateText(page);
    if (isTmallDateRangeMatched(lastText, range)) {
      return lastText;
    }
    await page.waitForTimeout(TMALL_DATE_POLL_INTERVAL_MS);
  }
  throw new Error(`天猫页面日期验收失败：期望=${expectedText}，实际=${describeTmallDateText(lastText)}。`);
}

module.exports = {
  waitForTmallPageDateApplied
};
