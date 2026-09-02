// 该文件用于读取拼多多日期面板并等待双月日历进入可操作状态。
const { waitForNextPddDateStateCheck } = require("./pddDateStateWait");

async function readPddDatePanelState(page) {
  // 这里读取可见日期面板的月份、表格数量和正文状态。
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const normalizeText = (element) => String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
    const panels = Array.from(document.querySelectorAll("[class*='RPR_outerPickerWrapper']")).filter(isVisible);
    const panel = panels[panels.length - 1] || null;
    if (!panel) {
      return { open: false, months: [], text: "" };
    }

    const headers = Array.from(panel.querySelectorAll("[class*='RPR_headerSelector']"))
      .filter(isVisible)
      .sort((left, right) => left.getBoundingClientRect().x - right.getBoundingClientRect().x);
    const tables = Array.from(panel.querySelectorAll("[class*='RPR_tableWrapper']"))
      .filter(isVisible)
      .sort((left, right) => left.getBoundingClientRect().x - right.getBoundingClientRect().x);
    const months = headers
      .map((header, index) => {
        const descendantsText = Array.from(header.querySelectorAll("*"))
          .map((element) => String(element.textContent || "").trim())
          .join(" ");
        const text = `${normalizeText(header)} ${String(header.textContent || "")} ${descendantsText}`.replace(/\s+/g, " ").trim();
        const yearMatch = text.match(/(\d{4})\s*年/);
        const monthMatch = text.match(/(\d{1,2})\s*月/);
        return {
          year: Number(yearMatch?.[1] || 0),
          month: Number(monthMatch?.[1] || 0),
          tableIndex: index,
          text
        };
      })
      .filter((item) => item.year > 0 && item.month > 0);

    return {
      open: true,
      months,
      tableCount: tables.length,
      text: normalizeText(panel)
    };
  });
}

async function waitForPddDatePanelOpen(page, timeoutMs = 10000) {
  // 这里等拼多多日期浮层真实出现，避免点击日期输入框后马上读面板导致空结果。
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 10000);
  let lastState = null;

  while (Date.now() <= deadline) {
    lastState = await readPddDatePanelState(page);
    if (lastState?.open && lastState.months.length >= 2 && lastState.tableCount >= 2) {
      return lastState;
    }

    await waitForNextPddDateStateCheck(deadline);
  }

  throw new Error(`点击拼多多日期控件后没有看到可操作的日期面板。最后状态：${JSON.stringify(lastState || {})}`);
}

function isPddDatePanelClosedState(panelState) {
  // 该函数只判断日期面板是否已经完全收起。
  return panelState?.open === false;
}

async function waitForPddDatePanelClosed(page, timeoutMs = 10000) {
  // 这里等待确认后的日期面板完全收起，避免面板中的日历变化被误当成报表刷新。
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 10000);
  let lastState = null;

  while (Date.now() <= deadline) {
    lastState = await readPddDatePanelState(page);
    if (isPddDatePanelClosedState(lastState)) {
      return lastState;
    }

    await waitForNextPddDateStateCheck(deadline);
  }

  throw new Error(`拼多多日期确认后，日期面板没有正常收起，已停止下载。最后状态：${JSON.stringify(lastState || {})}`);
}

module.exports = {
  readPddDatePanelState,
  waitForPddDatePanelOpen,
  isPddDatePanelClosedState,
  waitForPddDatePanelClosed
};
