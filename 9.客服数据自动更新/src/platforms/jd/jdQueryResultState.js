const { getJdExportButton } = require("./jdControls");
const { captureJdReportRefreshSnapshot } = require("./jdDateRefreshWaiter");
const { JD_STATE_POLL_INTERVAL_MS, normalizeText, waitForNextJdStateCheck } = require("./jdStateHelpers");
const { readLocatorActionabilityState } = require("../../shared/browserActionEngine");

async function captureJdResultState(surface, range) {
  // 这里补一层结果态快照：既看查询控件，也看表格/空态/加载态，导出只在结果明确后继续。
  const baseSnapshot = await captureJdReportRefreshSnapshot(surface, range);
  const tableState = await surface
    .evaluate(() => {
      const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
      };

      const rowSelectors = [
        ".el-table__body-wrapper tbody tr",
        ".el-table__body tr",
        ".ant-table-tbody > tr",
        "table tbody tr",
        "[role='rowgroup'] [role='row']"
      ];
      const rows = Array.from(document.querySelectorAll(rowSelectors.join(","))).filter((node) => isVisible(node));
      const rowTexts = rows.map((node) => normalizeText(node.textContent || "")).filter(Boolean);

      const emptySelectors = [
        ".el-table__empty-block",
        ".el-table__empty-text",
        ".ant-empty",
        ".ant-table-placeholder",
        "[class*='empty']"
      ];
      const emptyTexts = Array.from(document.querySelectorAll(emptySelectors.join(",")))
        .filter((node) => isVisible(node))
        .map((node) => normalizeText(node.textContent || ""))
        .filter(Boolean);

      const summaryText = rowTexts.slice(0, 5).join(" | ").slice(0, 1000);
      return {
        rowCount: rows.length,
        summaryText,
        hasDataRows: rows.length > 0,
        emptyText: emptyTexts.join(" | ")
      };
    });

  const exportButtonState = await readLocatorActionabilityState(getJdExportButton(surface));
  const exportDisabled = !exportButtonState.count || !exportButtonState.visible || exportButtonState.disabled;

  return {
    ...baseSnapshot,
    ...tableState,
    exportDisabled
  };
}

function hasJdResultStateChanged(beforeState, afterState) {
  return (
    beforeState.tableText !== afterState.tableText ||
    beforeState.loadingVisible !== afterState.loadingVisible ||
    beforeState.searchDisabled !== afterState.searchDisabled ||
    beforeState.searchClassName !== afterState.searchClassName ||
    beforeState.rowCount !== afterState.rowCount ||
    beforeState.summaryText !== afterState.summaryText ||
    beforeState.emptyText !== afterState.emptyText ||
    beforeState.exportDisabled !== afterState.exportDisabled
  );
}

async function waitForJdQueryResultReady(surface, range, beforeState, timeoutMs = 30000) {
  // 这里以“日期命中 + 查询结束 + 表格或空态稳定 + 导出按钮恢复”为准，不靠固定秒数推进。
  const deadline = Date.now() + timeoutMs;
  let sawBusyState = false;

  while (Date.now() <= deadline) {
    const currentState = await captureJdResultState(surface, range);

    if (currentState.loadingVisible || currentState.searchDisabled) {
      sawBusyState = true;
    }

    if (!currentState.rangeMatched) {
      await waitForNextJdStateCheck(deadline, JD_STATE_POLL_INTERVAL_MS);
      continue;
    }

    const changed = hasJdResultStateChanged(beforeState, currentState);
    const querySettled =
      !currentState.loadingVisible && !currentState.searchDisabled && !currentState.exportDisabled;

    if (querySettled && changed && (currentState.hasDataRows || Boolean(currentState.emptyText))) {
      return currentState;
    }

    if (querySettled && sawBusyState && (currentState.hasDataRows || Boolean(currentState.emptyText))) {
      return currentState;
    }

    await waitForNextJdStateCheck(deadline, JD_STATE_POLL_INTERVAL_MS);
  }

  throw new Error(
    `京东查询结果一直没有进入稳定状态：目标日期=${range.startText} 到 ${range.endText}。`
  );
}

module.exports = {
  captureJdResultState,
  waitForJdQueryResultReady
};
