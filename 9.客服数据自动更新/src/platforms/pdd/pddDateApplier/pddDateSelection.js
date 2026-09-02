const { formatDate } = require("../../../shared/exportDateRange");
const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const { toDateMonth, formatMonthLabel } = require("./pddCalendarMonth");

async function clickPddDateCell(page, panelState, targetDate) {
  // 该函数只在没有遮挡弹窗时点选指定日期。
  const targetMonth = toDateMonth(targetDate);
  const targetDay = targetDate.getDate();
  const clicked = await page.evaluate(
    ({ targetYear, targetMonthNumber, targetDayNumber }) => {
      const isVisible = (element) => {
        if (!element) {
          return false;
        }
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
      };
      const hasBlockingPopup = () => Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], #msg_box_modal"))
        .some((node) => isVisible(node) && !node.closest("[class*='RPR_outerPickerWrapper']"));
      const assertNoBlockingPopup = () => {
        if (hasBlockingPopup()) {
          throw new Error("拼多多日期操作检测到遮挡弹窗，已停止，未穿透点击日期控件。");
        }
      };
      const normalizeText = (element) => String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
      assertNoBlockingPopup();
      const panels = Array.from(document.querySelectorAll("[class*='RPR_outerPickerWrapper']")).filter(isVisible);
      const panel = panels[panels.length - 1] || null;
      if (!panel) {
        return false;
      }
      const headers = Array.from(panel.querySelectorAll("[class*='RPR_headerSelector']"))
        .filter(isVisible)
        .sort((left, right) => left.getBoundingClientRect().x - right.getBoundingClientRect().x);
      const tables = Array.from(panel.querySelectorAll("[class*='RPR_tableWrapper']"))
        .filter(isVisible)
        .sort((left, right) => left.getBoundingClientRect().x - right.getBoundingClientRect().x);
      const targetTableIndex = headers.findIndex((header) => {
        const descendantsText = Array.from(header.querySelectorAll("*"))
          .map((element) => String(element.textContent || "").trim())
          .join(" ");
        const text = `${normalizeText(header)} ${String(header.textContent || "")} ${descendantsText}`.replace(/\s+/g, " ").trim();
        const year = Number(text.match(/(\d{4})\s*年/)?.[1] || 0);
        const month = Number(text.match(/(\d{1,2})\s*月/)?.[1] || 0);
        return year === targetYear && month === targetMonthNumber;
      });
      const table = tables[targetTableIndex];
      if (!table) {
        return false;
      }
      const cell = Array.from(table.querySelectorAll("div[class*='RPR_cell']"))
        .filter(isVisible)
        .find((item) => {
          const className = String(item.className || "");
          return normalizeText(item) === String(targetDayNumber) && !className.includes("RPR_disabled") && !className.includes("RPR_outOfMonth");
        });
      if (!cell) {
        return false;
      }
      const clickTarget = cell.closest("td") || cell;
      for (const eventName of ["mousedown", "mouseup", "click"]) {
        assertNoBlockingPopup();
        clickTarget.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
      }
      return true;
    },
    {
      targetYear: targetMonth.year,
      targetMonthNumber: targetMonth.month,
      targetDayNumber: targetDay
    }
  );
  if (!clicked) {
    const monthsText = (panelState?.months || []).map((item) => formatMonthLabel(item)).join("、") || "未读到";
    throw new Error(`拼多多日期面板里没有可点击的日期：${formatDate(targetDate)}。当前月份：${monthsText}`);
  }
  return true;
}

async function clickPddDatePanelConfirm(page) {
  // 该函数只真实点击日期面板内唯一的确认按钮。
  const confirmButton = page.locator("[class*='RPR_outerPickerWrapper']:visible button:has-text('确认')").last();
  await clickLocatorWhenReady(confirmButton, "拼多多日期确认按钮", { timeoutMs: 5000 });
}

module.exports = {
  clickPddDateCell,
  clickPddDatePanelConfirm
};
