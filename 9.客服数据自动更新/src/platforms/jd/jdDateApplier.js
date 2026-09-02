const {
  waitForNextJdDateStateCheck,
  JD_DATE_STATE_POLL_INTERVAL_MS
} = require("./dateStateParts/jdDateStatePolling");

async function waitForJdDateFilterApplied(surface, range, timeoutMs = 15000) {
  // 这里动态等待页面顶部日期控件真的切到目标值，避免搜索时沿用上一次条件。
  const deadline = Date.now() + timeoutMs;
  const expectedStart = String(range.startText || "").trim();
  const expectedEnd = String(range.endText || "").trim();

  while (Date.now() <= deadline) {
    const values = await surface.locator("input").evaluateAll((elements) =>
      elements
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
        })
        .map((element) => String(element.value || "").trim())
    );

    const text = values.join(" | ");
    const hasStart = values.some((item) => item === expectedStart || item.includes(expectedStart));
    const hasEnd = values.some((item) => item === expectedEnd || item.includes(expectedEnd));
    const hasCombined = values.some(
      (item) => item.includes(expectedStart) && item.includes(expectedEnd)
    );

    if ((hasStart && hasEnd) || hasCombined) {
      return text;
    }

    await waitForNextJdDateStateCheck(deadline, JD_DATE_STATE_POLL_INTERVAL_MS);
  }

  throw new Error(`京东日期控件没有切换到目标区间：${range.startText} 到 ${range.endText}`);
}

module.exports = {
  waitForJdDateFilterApplied
};
