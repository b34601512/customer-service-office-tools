// 该文件用于读取拼多多日期输入框并确认目标区间已经真实生效。
const { isPddDateRangeTextMatched } = require("./pddDateText");
const { waitForNextPddDateStateCheck } = require("./pddDateStateWait");

function getPddDateInput(page) {
  // 这里返回日期范围控件的首个输入入口，保持原选择器不变。
  return page.locator("input[placeholder*='开始时间'], input[placeholder*='结束时间']").first();
}

async function readPddDateInputValues(page) {
  // 这里读取所有可见日期输入值，供生效确认和无需修改判断共用。
  return page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };

    return Array.from(document.querySelectorAll("input"))
      .filter(isVisible)
      .map((element) => ({
        value: String(element.value || "").trim(),
        placeholder: String(element.getAttribute("placeholder") || "").trim()
      }))
      .filter((item) => /开始时间|结束时间/.test(item.placeholder) || /\d{4}-\d{2}-\d{2}.*[~～].*\d{4}-\d{2}-\d{2}/.test(item.value))
      .map((item) => item.value)
      .filter(Boolean);
  });
}

async function waitForPddDateRangeApplied(page, range, timeoutMs = 15000) {
  // 这里必须等输入框真实回显目标区间，再允许后续下载，避免导出旧日期文件。
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 15000);
  let lastValues = [];

  while (Date.now() <= deadline) {
    lastValues = await readPddDateInputValues(page);
    const matchedValue = lastValues.find((value) => isPddDateRangeTextMatched(value, range));
    if (matchedValue) {
      return matchedValue;
    }

    await waitForNextPddDateStateCheck(deadline);
  }

  throw new Error(
    `拼多多日期控件没有切换到目标区间：${range.startText} 到 ${range.endText}。当前读到：${lastValues.join(" | ") || "空"}`
  );
}

module.exports = {
  getPddDateInput,
  readPddDateInputValues,
  waitForPddDateRangeApplied
};
