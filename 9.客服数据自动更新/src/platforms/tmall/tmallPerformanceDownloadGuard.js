const path = require("path");
const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");
const { wait } = require("../../shared/browserActionEngine");

function buildTmallDownloadDateToken(dateText) {
  // 这里把页面标准日期转换成下载文件名里的日期片段，用于导入前硬校验。
  const match = String(dateText || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`天猫下载日期格式不合法：${dateText || "空"}`);
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

function extractTmallPerformanceFileDateRange(fileName) {
  // 这里只识别生意参谋业绩导出文件名里的日期区间，避免错日期文件进入导入流程。
  const baseName = path.basename(String(fileName || ""));
  const match = baseName.match(/_(\d{8})_(\d{8})(?:_|\.|$)/);
  if (!match) {
    return null;
  }
  return {
    startToken: match[1],
    endToken: match[2]
  };
}

function assertTmallPerformanceDownloadMatchesRange(fileName, range) {
  // 这里在导入前拦住错日期文件，宁愿失败暴露，也不能把错误数据写入汇总表。
  const expectedStartToken = buildTmallDownloadDateToken(range?.startText);
  const expectedEndToken = buildTmallDownloadDateToken(range?.endText);
  const actualRange = extractTmallPerformanceFileDateRange(fileName);
  const baseName = path.basename(String(fileName || ""));

  if (!actualRange) {
    throw new Error(`天猫下载文件日期无法校验：文件名没有包含日期区间，文件=${baseName || "空"}`);
  }

  if (actualRange.startToken !== expectedStartToken || actualRange.endToken !== expectedEndToken) {
    throw new Error(
      `天猫下载文件日期不匹配：页面期望=${expectedStartToken}_${expectedEndToken}，文件实际=${actualRange.startToken}_${actualRange.endToken}，文件=${baseName}`
    );
  }
}

async function captureTmallPerformanceReportState(page, range) {
  // 这里读取天猫报表的可操作状态，专门避免页面还在刷新时提前点击下载。
  return page.evaluate(({ startText, endText }) => {
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const currentDateText = normalizeText(
      document.querySelector(".oui-date-picker-current-date")?.textContent || ""
    );
    const compactDateText = currentDateText.replace(/\s+/g, "").replace(/至/g, "~").replace(/～/g, "~");
    const dateMatch = compactDateText.match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);
    const visibleNodes = Array.from(document.querySelectorAll("body *")).filter(isVisible);
    const visibleNodeTexts = visibleNodes
      .map((node) => normalizeText(node.textContent || ""))
      .filter(Boolean);
    const loadingTexts = visibleNodeTexts.filter(
      (text) => /资源加载中|加载中|查询中|正在加载|loading/i.test(text) && text.length <= 120
    );
    const bodyText = normalizeText(document.body?.innerText || "");
    const downloadButtonVisible = Array.from(
      document.querySelectorAll("button, a, [role='button']")
    ).some((node) => isVisible(node) && normalizeText(node.textContent || "") === "下载");
    const rowTexts = Array.from(
      document.querySelectorAll(
        "tbody tr, .next-table-row, .oui-table-row, [role='rowgroup'] [role='row'], [class*='table'] [class*='row']"
      )
    )
      .filter(isVisible)
      .map((node) => normalizeText(node.textContent || ""))
      .filter(Boolean);
    const tableText = rowTexts.slice(0, 8).join(" | ");
    const hasPerformanceHeader =
      /旺旺昵称/.test(bodyText) && (/询单人数|下单金额|净销售额|咨询人数/.test(bodyText));
    const hasNoDataText = /暂无数据|没有数据|无数据/.test(bodyText);

    return {
      currentDateText,
      rangeMatched: Boolean(dateMatch && dateMatch[1] === startText && dateMatch[2] === endText),
      loadingVisible: loadingTexts.length > 0,
      loadingText: loadingTexts[0] || "",
      downloadButtonVisible,
      hasPerformanceHeader,
      hasNoDataText,
      rowCount: rowTexts.length,
      tableText,
      signature: [
        currentDateText,
        downloadButtonVisible ? "download" : "no-download",
        hasPerformanceHeader ? "header" : "no-header",
        hasNoDataText ? "empty" : "not-empty",
        rowTexts.length,
        tableText.slice(0, 500)
      ].join("|")
    };
  }, {
    startText: range.startText,
    endText: range.endText
  });
}

function isTmallPerformanceReportStateReady(state) {
  // 这里只判断页面是否已经具备安全下载条件，具体等待节奏交给外层循环。
  return Boolean(
    state?.rangeMatched &&
      !state.loadingVisible &&
      state.downloadButtonVisible &&
      (state.hasPerformanceHeader || state.hasNoDataText)
  );
}

function describeTmallPerformanceReportState(state) {
  // 这里把最后一次页面状态转成中文原因，方便现场排查到底卡在哪。
  if (!state) {
    return "未读取到页面状态";
  }
  if (!state.rangeMatched) {
    return `日期未命中，页面日期=${state.currentDateText || "未读到"}`;
  }
  if (state.loadingVisible) {
    return `页面仍在加载，加载文本=${state.loadingText || "未读到"}`;
  }
  if (!state.downloadButtonVisible) {
    return "下载按钮不可见";
  }
  if (!state.hasPerformanceHeader && !state.hasNoDataText) {
    return "未看到业绩表头或空数据提示";
  }
  return "页面状态已满足下载条件";
}

async function waitForTmallPerformanceReportStable(page, range, options = {}) {
  // 这里要求结果态连续稳定两轮，防止日期刚确认后页面又进入二次加载。
  const timeoutMs = Number(options.timeoutMs || Math.min(appConfig.tmall.connectTimeoutMs, 90000));
  const pollIntervalMs = Number(options.pollIntervalMs || appConfig.tmall.pageReadyPollIntervalMs);
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let lastReadySignature = "";
  let stableReadyCount = 0;

  while (Date.now() <= deadline) {
    lastState = await captureTmallPerformanceReportState(page, range);
    if (isTmallPerformanceReportStateReady(lastState)) {
      if (lastState.signature === lastReadySignature) {
        stableReadyCount += 1;
      } else {
        lastReadySignature = lastState.signature;
        stableReadyCount = 1;
      }

      if (stableReadyCount >= 2) {
        log(
          "主线:完成",
          "天猫下载",
          "结果稳定",
          `页面日期=${lastState.currentDateText}，数据行=${lastState.rowCount}`
        );
        return lastState;
      }
    } else {
      lastReadySignature = "";
      stableReadyCount = 0;
    }

    await wait(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }

  throw new Error(`天猫业绩指标结果一直没有稳定：${describeTmallPerformanceReportState(lastState)}。`);
}

module.exports = {
  waitForTmallPerformanceReportStable,
  assertTmallPerformanceDownloadMatchesRange,
  isTmallPerformanceReportStateReady
};
