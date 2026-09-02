// 该文件用于确认拼多多日期变更后的报表数据与下载入口已经可用。
const { waitForPddDateRangeApplied } = require("./pddDateInputState");
const { readPddDatePanelState } = require("./pddDatePanelState");
const { waitForNextPddDateStateCheck } = require("./pddDateStateWait");

async function readPddReportCandidateTexts(page) {
  // 这里只读取日期面板之外的可见表格候选，日历表格不能参与报表刷新判断。
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const candidates = Array.from(
      document.querySelectorAll(".table-module, [class*='table-module'], table, [class*='TABLE']")
    ).filter((element) => {
      const datePanelSelector = "[class*='RPR_outerPickerWrapper']";
      return isVisible(element) && !element.closest(datePanelSelector) && !element.querySelector(datePanelSelector);
    });
    return candidates
      .map((element) => normalizeText(element.innerText || element.textContent || ""))
      .filter(Boolean);
  });
}

function isPddReportDataText(value) {
  // 该函数只识别真实客服报表文字，日历、导航和其他页面表格都不算报表数据。
  const normalizedText = String(value || "").replace(/\s+/g, " ").trim();
  return normalizedText.includes("客服账号") &&
    /(咨询人数|人工接待人数)/.test(normalizedText) &&
    /(客服销售额|询单人数|最终成团人数)/.test(normalizedText);
}

async function readPddReportDataSignature(page) {
  // 这里读取真实报表区的稳定文本，用来判断改日期后数据区是否真的刷新过。
  const reportCandidateTexts = await readPddReportCandidateTexts(page);
  return reportCandidateTexts.filter(isPddReportDataText).join(" | ").slice(0, 1200);
}

function isPddActiveLoadingSignal({ className = "", ariaText = "", text = "" } = {}) {
  // 这里只识别真正活跃的加载态，避免 ant-spin-container 这类普通容器把页面永久误判为加载中。
  const safeClassName = String(className || "");
  const safeAriaText = String(ariaText || "");
  const safeText = String(text || "").replace(/\s+/g, " ").trim();
  if (/加载中|查询中|正在加载/.test(safeText) && safeText.length <= 80) {
    return true;
  }

  if (
    /(^|\s)(ant-spin-spinning|el-loading-mask|el-loading-spinner)(\s|$)/i.test(safeClassName) ||
    /loading-(mask|spinner)|spinner-(border|grow)|pdd[^\s]*(loading|spinner)/i.test(safeClassName)
  ) {
    return true;
  }

  return /loading|加载|spin|spinner/i.test(safeAriaText) && !/container|content|wrapper/i.test(safeClassName);
}

async function readPddReportLoadingState(page) {
  // 这里识别拼多多常见的加载中状态，避免日期刚切完就点下载导致点击被页面刷新吞掉。
  const loadingCandidates = await page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll("*")).map((element) => {
      if (!isVisible(element)) {
        return null;
      }
      const className = String(element.className || "");
      const ariaText = String(element.getAttribute("aria-label") || "");
      const text = String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      if (!/加载|查询中|loading|spin|spinner/i.test(`${className} ${ariaText} ${text.slice(0, 80)}`)) {
        return null;
      }

      return {
        className,
        ariaText,
        text: text.slice(0, 120)
      };
    }).filter(Boolean).slice(0, 80);
  });
  return loadingCandidates.some((item) => isPddActiveLoadingSignal(item));
}

async function readPddDownloadButtonReadyState(page) {
  // 这里只认报表区“下载表单”按钮，避免顶部客户端下载入口混进来。
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const candidates = Array.from(
      document.querySelectorAll("a.pdd-btn-download, a, button, [role='button']")
    ).filter((element) => /下载表单/.test(String(element.innerText || element.textContent || "")));
    const target =
      candidates.find((element) => element.matches("a.pdd-btn-download")) ||
      candidates.find((element) => String(element.closest(".table-module")?.textContent || "").includes("下载表单")) ||
      candidates[0] ||
      null;
    if (!target) {
      return { visible: false, disabled: false, text: "", rect: null };
    }

    const rect = target.getBoundingClientRect();
    return {
      visible: isVisible(target),
      disabled: Boolean(target.disabled || target.getAttribute("aria-disabled") === "true"),
      text: String(target.innerText || target.textContent || "").replace(/\s+/g, " ").trim(),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  });
}

function isPddReportReadyState({
  buttonState,
  currentSignature,
  signatureChanged,
  isLoading,
  datePanelOpen
} = {}) {
  // 该函数只判断当前页面是否已经满足安全下载的全部条件。
  return Boolean(
    buttonState?.visible &&
    !buttonState?.disabled &&
    currentSignature &&
    signatureChanged &&
    !isLoading &&
    !datePanelOpen
  );
}

async function waitForPddReportReadyAfterDateApply(page, range, timeoutMs = 30000, options = {}) {
  // 这里等日期命中、报表区刷新完成、下载入口可点击，避免日期刚确认后首次下载点击被页面刷新吞掉。
  const appliedText = await waitForPddDateRangeApplied(page, range, timeoutMs);
  const previousSignature = String(options.previousReportSignature || "").trim();
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 30000);
  let lastState = {};

  while (Date.now() <= deadline) {
    const [buttonState, currentSignature, isLoading, datePanelState] = await Promise.all([
      readPddDownloadButtonReadyState(page),
      readPddReportDataSignature(page),
      readPddReportLoadingState(page),
      readPddDatePanelState(page)
    ]);
    const signatureChanged = !previousSignature || (currentSignature && currentSignature !== previousSignature);
    const datePanelOpen = Boolean(datePanelState?.open);
    lastState = {
      buttonState,
      isLoading,
      datePanelOpen,
      signatureChanged,
      currentSignatureLength: String(currentSignature || "").length
    };

    if (isPddReportReadyState({ buttonState, currentSignature, signatureChanged, isLoading, datePanelOpen })) {
      return appliedText;
    }

    await waitForNextPddDateStateCheck(deadline);
  }

  throw new Error(
    `拼多多日期已回显为 ${range.startText} 到 ${range.endText}，但报表区没有刷新到可下载状态。最后状态：${JSON.stringify(lastState)}`
  );
}

module.exports = {
  readPddReportCandidateTexts,
  isPddReportDataText,
  readPddReportDataSignature,
  isPddActiveLoadingSignal,
  readPddReportLoadingState,
  readPddDownloadButtonReadyState,
  isPddReportReadyState,
  waitForPddReportReadyAfterDateApply
};
