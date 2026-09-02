const { getJdSearchButton } = require("./jdControls");
const {
  waitForNextJdDateStateCheck,
  JD_DATE_STATE_POLL_INTERVAL_MS
} = require("./dateStateParts/jdDateStatePolling");

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasJdRangeValues(values, range) {
  const expectedStart = String(range?.startText || "").trim();
  const expectedEnd = String(range?.endText || "").trim();
  const hasStart = values.some((item) => item === expectedStart || item.includes(expectedStart));
  const hasEnd = values.some((item) => item === expectedEnd || item.includes(expectedEnd));
  const hasCombined = values.some((item) => item.includes(expectedStart) && item.includes(expectedEnd));
  return (hasStart && hasEnd) || hasCombined;
}

function hasJdRefreshSignalChanged(beforeSnapshot, afterSnapshot) {
  return (
    beforeSnapshot.tableText !== afterSnapshot.tableText ||
    beforeSnapshot.loadingVisible !== afterSnapshot.loadingVisible ||
    beforeSnapshot.searchDisabled !== afterSnapshot.searchDisabled ||
    beforeSnapshot.searchClassName !== afterSnapshot.searchClassName
  );
}

function isJdRefreshSnapshotSettled(snapshot) {
  return Boolean(
    snapshot?.rangeMatched &&
      !snapshot.loadingVisible &&
      !snapshot.searchDisabled &&
      normalizeText(snapshot.tableText)
  );
}

function shouldAcceptAlreadySettledJdRefresh(beforeSnapshot, currentSnapshot) {
  // 京东系统页日期选择后可能已刷新结果，再点查询不会改变表格；这种已稳定状态应继续导出。
  return Boolean(
    isJdRefreshSnapshotSettled(beforeSnapshot) &&
      isJdRefreshSnapshotSettled(currentSnapshot) &&
      beforeSnapshot.tableText === currentSnapshot.tableText
  );
}

async function captureJdReportRefreshSnapshot(surface, range) {
  // 这里抓取搜索前后的页面快照，用真实页面状态判断报表是否已经刷新完成。
  const values = await surface
    .locator("input")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
        })
        .map((element) => String(element.value || "").trim())
    );

  const loadingVisible = await surface
    .evaluate(() => {
      const selectors = [
        ".el-loading-mask",
        ".el-loading-spinner",
        ".ant-spin-spinning",
        ".ant-spin",
        "[class*='loading-mask']",
        "[class*='loading-spinner']"
      ];
      return Array.from(document.querySelectorAll(selectors.join(","))).some((node) => {
        const style = window.getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
      });
    });

  const tableText = await surface
    .locator(
      [
        ".el-table__body-wrapper",
        ".el-table__body",
        ".ant-table-tbody",
        "table tbody",
        "[role='rowgroup']"
      ].join(", ")
    )
    .first()
    .innerText()
    .then((text) => normalizeText(text).slice(0, 1000));

  const searchButton = getJdSearchButton(surface);
  const searchDisabled = await searchButton.isDisabled();
  const searchClassName = await searchButton.getAttribute("class").then((value) => normalizeText(value));

  return {
    values,
    loadingVisible,
    tableText,
    searchDisabled,
    searchClassName,
    rangeMatched: hasJdRangeValues(values, range)
  };
}

async function waitForJdReportRefreshAfterSearch(surface, range, beforeSnapshot, timeoutMs = 20000) {
  // 这里等待搜索动作真的把报表数据刷新完，避免日期输入框变了但表格仍是刷新前数据就提前导出。
  const deadline = Date.now() + timeoutMs;
  let sawBusyState = false;
  let alreadySettledCount = 0;

  while (Date.now() <= deadline) {
    const currentSnapshot = await captureJdReportRefreshSnapshot(surface, range);
    if (currentSnapshot.loadingVisible || currentSnapshot.searchDisabled) {
      sawBusyState = true;
    }

    if (!currentSnapshot.rangeMatched) {
      await waitForNextJdDateStateCheck(deadline, JD_DATE_STATE_POLL_INTERVAL_MS);
      continue;
    }

    const changed = hasJdRefreshSignalChanged(beforeSnapshot, currentSnapshot);
    if (changed && !currentSnapshot.loadingVisible && !currentSnapshot.searchDisabled) {
      return currentSnapshot;
    }

    if (sawBusyState && !currentSnapshot.loadingVisible && !currentSnapshot.searchDisabled) {
      return currentSnapshot;
    }

    if (shouldAcceptAlreadySettledJdRefresh(beforeSnapshot, currentSnapshot)) {
      alreadySettledCount += 1;
      if (alreadySettledCount >= 2) {
        return currentSnapshot;
      }
    } else {
      alreadySettledCount = 0;
    }

    await waitForNextJdDateStateCheck(deadline, Math.min(JD_DATE_STATE_POLL_INTERVAL_MS, 200));
  }

  throw new Error(
    `京东报表搜索后一直没有确认刷新完成：目标日期=${range.startText} 到 ${range.endText}。请确认页面是否真的完成查询。`
  );
}

module.exports = {
  captureJdReportRefreshSnapshot,
  waitForJdReportRefreshAfterSearch,
  hasJdRangeValues,
  hasJdRefreshSignalChanged,
  isJdRefreshSnapshotSettled,
  shouldAcceptAlreadySettledJdRefresh
};
