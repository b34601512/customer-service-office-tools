const { waitFor } = require("./page_runtime");
const { log } = require("./logger");
const { ensureLoggedIn } = require("./login_action");
const { ensurePhoneMenu } = require("./phone_menu_action");
const { openReportTab } = require("./report_tab_action");
const { applyDateRange } = require("./date_action");
const { downloadByPageExport } = require("./export_action");

function reportLabel(reportType) {
  if (reportType === "inbound") return "呼入";
  if (reportType === "outbound") return "呼出";
  return "呼损";
}

async function downloadOneReport(config, reportType, browserSession) {
  const { cdp, sessionId } = browserSession;
  log("开始报表", reportLabel(reportType));
  await waitFor(cdp, sessionId, `document.readyState === "complete" || document.readyState === "interactive"`, "页面加载", 30000);
  await ensureLoggedIn(cdp, sessionId, config);
  await ensurePhoneMenu(cdp, sessionId);
  await openReportTab(cdp, sessionId, reportType);
  await applyDateRange(cdp, sessionId, config, reportType);
  log("导出下载", reportLabel(reportType));
  const downloaded = await downloadByPageExport(cdp, sessionId, config, reportType);
  log("下载完成", `${reportType}=${downloaded}`);
  return downloaded;
}

module.exports = { downloadOneReport };
