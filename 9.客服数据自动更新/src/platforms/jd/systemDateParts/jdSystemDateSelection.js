const { formatDate } = require("../../../shared/exportDateRange");
const { dismissBlockingPopups } = require("../../../shared/blockingPopupEngine");
const { waitForJdDateStateDelay, JD_DATE_STATE_POLL_INTERVAL_MS } = require("../dateStateParts/jdDateStatePolling");
const { resolveJdSystemPanelIndex } = require("./jdSystemDateMonth");
const { findVisibleJdSystemDatePanel } = require("./jdSystemDatePanel");

const JD_SYSTEM_DATE_EDITOR_SELECTOR = ".kf-manage-lite-picker-range";

function pickLowestVisibleDateEditorIndex(editorRects) {
  // 该函数只从元素矩形中选择页面位置最低的可见日期控件。
  const visibleRects = (editorRects || [])
    .map((item, index) => ({ index, visible: Boolean(item?.visible), top: Number(item?.top), height: Number(item?.height) }))
    .filter((item) => item.visible && Number.isFinite(item.top) && item.height > 0);
  if (!visibleRects.length) {
    return -1;
  }
  return visibleRects.reduce((selected, current) => (current.top > selected.top ? current : selected)).index;
}

async function getVisibleJdSystemDateEditor(surface) {
  // 该函数只定位页面中最低的可见系统日期范围控件。
  const systemEditors = surface.locator(JD_SYSTEM_DATE_EDITOR_SELECTOR);
  const editorRects = await systemEditors.evaluateAll((elements) => elements.map((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0, top: rect.top, height: rect.height };
  }));
  const selectedIndex = pickLowestVisibleDateEditorIndex(editorRects);
  if (selectedIndex >= 0) {
    return systemEditors.nth(selectedIndex);
  }
  throw new Error("没有找到京东系统「数据明细」日期范围控件。");
}

async function clickJdSystemDateRangeCells(panel, months, startDate, endDate) {
  // 该函数只在没有遮挡弹窗时连续点选开始和结束日期。
  const result = await panel.evaluate(
    async (panelRoot, payload) => {
      const nextFrame = () => new Promise((resolve) => {
        if (window.requestAnimationFrame) {
          window.requestAnimationFrame(() => resolve());
          return;
        }
        window.setTimeout(resolve, 0);
      });
      const isVisible = (node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const assertNoBlockingPopup = () => {
        const hasBlockingPopup = Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], #msg_box_modal"))
          .some((node) => isVisible(node) && !node.contains(panelRoot));
        if (hasBlockingPopup) {
          throw new Error("京东日期操作检测到遮挡弹窗，已停止，未穿透点击日期控件。");
        }
      };
      const clickDate = (panelIndex, dateText) => {
        assertNoBlockingPopup();
        const panels = Array.from(panelRoot.querySelectorAll(".kf-manage-lite-picker-panel"));
        const targetPanel = panels[panelIndex];
        if (!targetPanel) {
          return { ok: false, reason: `缺少第${panelIndex + 1}个日期面板` };
        }
        const cell = targetPanel.querySelector(`td[title='${dateText}'].kf-manage-lite-picker-cell-in-view:not(.kf-manage-lite-picker-cell-disabled) .kf-manage-lite-picker-cell-inner`);
        if (!cell) {
          return { ok: false, reason: `缺少可点击日期${dateText}` };
        }
        for (const eventName of ["mousedown", "mouseup", "click"]) {
          assertNoBlockingPopup();
          cell.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
        }
        return { ok: true };
      };
      const startResult = clickDate(payload.startPanelIndex, payload.startText);
      if (!startResult.ok) {
        return startResult;
      }
      await nextFrame();
      await nextFrame();
      return clickDate(payload.endPanelIndex, payload.endText);
    },
    {
      startPanelIndex: resolveJdSystemPanelIndex(months, startDate),
      endPanelIndex: resolveJdSystemPanelIndex(months, endDate),
      startText: formatDate(startDate),
      endText: formatDate(endDate)
    }
  );
  if (!result?.ok) {
    throw new Error(`京东系统日期面板点选失败：${result?.reason || "未知原因"}`);
  }
}

async function dismissJdSystemDatePanelIfNeeded(surface) {
  // 该函数只在确认没有遮挡弹窗后收起仍可见的日期面板。
  await dismissBlockingPopups(surface, { platformName: "京东" });
  const panel = await findVisibleJdSystemDatePanel(surface);
  if (!panel) {
    return;
  }
  const surfacePage = typeof surface?.page === "function" ? surface.page() : surface;
  await surfacePage.keyboard.press("Escape");
  await waitForJdDateStateDelay(JD_DATE_STATE_POLL_INTERVAL_MS);
}

module.exports = {
  getVisibleJdSystemDateEditor,
  clickJdSystemDateRangeCells,
  dismissJdSystemDatePanelIfNeeded
};
