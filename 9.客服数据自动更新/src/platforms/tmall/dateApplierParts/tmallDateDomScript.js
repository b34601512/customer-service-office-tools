const { log } = require("../../../engine/logger");
const { assertTmallDateText } = require("./tmallDateDomSelectors");
const { TMALL_DATE_SCRIPT_TIMEOUT_MS } = require("./tmallDateConstants");

function buildTmallDateScriptPayload(range) {
  // 该函数只把外部日期配置收敛成页面脚本所需参数。
  if (!range?.startText || !range?.endText) {
    throw new Error("天猫日期脚本参数缺少开始日期或结束日期。");
  }
  return {
    startText: assertTmallDateText(range.startText),
    endText: assertTmallDateText(range.endText),
    timeoutMs: TMALL_DATE_SCRIPT_TIMEOUT_MS
  };
}

async function runTmallDateDomSelectionInPage(payload) {
  // 该函数只在没有遮挡弹窗时操作天猫日期面板。
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    if (!node) {
      return false;
    }
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const hasBlockingPopup = () => Array.from(document.querySelectorAll("[role='dialog'], [aria-modal='true'], #msg_box_modal"))
    .some((node) => visible(node) && !node.closest(".oui-date-picker-menu"));
  const assertNoBlockingPopup = () => {
    if (hasBlockingPopup()) {
      throw new Error("天猫日期操作检测到遮挡弹窗，已停止，未穿透点击日期控件。");
    }
  };
  const normalizeText = (value) => String(value || "").replace(/\s+/g, "").trim();
  const clickNode = (node, label) => {
    if (!node) {
      throw new Error(`天猫日期脚本缺少可点击节点：${label}`);
    }
    const dispatchMouseEvent = (eventName) => {
      assertNoBlockingPopup();
      node.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
    };
    dispatchMouseEvent("mouseover");
    dispatchMouseEvent("mousedown");
    dispatchMouseEvent("mouseup");
    dispatchMouseEvent("click");
  };
  const waitFor = async (predicate, label, timeoutMs = payload.timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let lastValue = null;
    while (Date.now() <= deadline) {
      assertNoBlockingPopup();
      lastValue = predicate();
      if (lastValue) {
        return lastValue;
      }
      await sleep(100);
    }
    throw new Error(`等待${label}超时，最后状态=${String(lastValue)}`);
  };
  const getOpenPanel = () => Array.from(document.querySelectorAll(".oui-date-picker-menu.open")).find(visible);
  const openDatePanel = async () => {
    let panel = getOpenPanel();
    if (panel) {
      return panel;
    }
    const customButton = Array.from(document.querySelectorAll("button, a, [role='button']")).find(
      (node) => visible(node) && /^\s*自定义\s*$/.test(node.textContent || "")
    );
    clickNode(customButton, "自定义日期按钮");
    return waitFor(getOpenPanel, "天猫日期面板打开");
  };
  const isTabActive = (node) => {
    const className = String(node?.className || "");
    const ariaSelected = String(node?.getAttribute("aria-selected") || "").toLowerCase();
    const ariaPressed = String(node?.getAttribute("aria-pressed") || "").toLowerCase();
    return /(^|\s)active(\s|$)/.test(className) || ariaSelected === "true" || ariaPressed === "true";
  };
  const ensureDailyTabSelected = async () => {
    const panel = getOpenPanel();
    const dailyTab = Array.from(panel?.querySelectorAll(".rangeSwitch span") || []).find((node) => /^\s*日粒度\s*$/.test(node.textContent || ""));
    if (!dailyTab || isTabActive(dailyTab)) {
      return;
    }
    clickNode(dailyTab, "日粒度");
    await waitFor(() => isTabActive(dailyTab), "日粒度选中");
  };
  const parseTargetMonth = (dateText) => {
    const [year, month] = String(dateText).split("-").map(Number);
    return { year, month, index: year * 12 + month };
  };
  const readPanelMonth = (panelClassName) => {
    const panel = getOpenPanel()?.querySelector(`.${panelClassName}`);
    if (!panel) {
      throw new Error(`天猫日期脚本缺少面板：${panelClassName}`);
    }
    const year = Number((panel.querySelector("[data-role='current-year']")?.textContent || "").replace(/[^\d]/g, ""));
    const month = Number((panel.querySelector("[data-role='current-month']")?.textContent || "").replace(/[^\d]/g, ""));
    if (!year || !month) {
      throw new Error(`天猫日期脚本无法读取${panelClassName}年月。`);
    }
    return { year, month, index: year * 12 + month };
  };
  const navigatePanelToMonth = async (panelClassName, targetDateText) => {
    const targetMonth = parseTargetMonth(targetDateText);
    for (let index = 0; index < 24; index += 1) {
      const currentMonth = readPanelMonth(panelClassName);
      if (currentMonth.index === targetMonth.index) {
        return currentMonth;
      }
      const actionRole = currentMonth.index < targetMonth.index ? "next-month" : "prev-month";
      const button = getOpenPanel().querySelector(`.${panelClassName} [data-role='${actionRole}']:not(.disabled)`);
      clickNode(button, `${panelClassName}${actionRole}`);
      await waitFor(() => {
        const nextMonth = readPanelMonth(panelClassName);
        return nextMonth.index !== currentMonth.index ? nextMonth : null;
      }, `${panelClassName}切月`);
    }
    throw new Error(`天猫日期脚本未能把${panelClassName}切到目标月份：${targetDateText}`);
  };
  const selectDateCell = async (panelClassName, dateText) => {
    await navigatePanelToMonth(panelClassName, dateText);
    const selector = `.${panelClassName} td[data-role='date'][data-value='${dateText}']:not(.disabled-element)`;
    const cell = await waitFor(() => getOpenPanel()?.querySelector(selector), `${panelClassName}目标日期${dateText}`);
    clickNode(cell, `${panelClassName}目标日期${dateText}`);
  };
  const waitForPreview = async () => waitFor(() => {
    const previewText = getOpenPanel()?.querySelector(".rangeValue")?.textContent || "";
    return previewText.includes(payload.startText) && previewText.includes(payload.endText) ? previewText : "";
  }, "天猫日期面板预览命中");
  const confirmSelection = () => {
    const confirmButton = Array.from(getOpenPanel()?.querySelectorAll("button, [role='button']") || [])
      .filter((node) => /^\s*确\s*定\s*$/.test(node.textContent || ""))
      .pop();
    clickNode(confirmButton, "日期确认按钮");
  };

  assertNoBlockingPopup();
  await openDatePanel();
  await ensureDailyTabSelected();
  await selectDateCell("rangeLeft", payload.startText);
  await selectDateCell("rangeRight", payload.endText);
  const previewText = await waitForPreview();
  confirmSelection();
  return {
    previewText: normalizeText(previewText),
    currentDateText: normalizeText(document.querySelector(".oui-date-picker-current-date")?.textContent || "")
  };
}

async function applyTmallDateRangeByDomScript(page, range) {
  // 该函数只把天猫日期选择收口为一条可验证的页面操作链。
  const payload = buildTmallDateScriptPayload(range);
  log("主线:执行", "天猫日期", "页面脚本", `准备直达选择：${payload.startText} 到 ${payload.endText}`);
  const result = await page.evaluate(runTmallDateDomSelectionInPage, payload);
  log("主线:完成", "天猫日期", "页面脚本", `面板预览=${result.previewText || "未读到"}`);
  return result;
}

module.exports = {
  applyTmallDateRangeByDomScript,
  buildTmallDateScriptPayload
};
