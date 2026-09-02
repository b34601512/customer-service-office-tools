const { evaluate, waitFor } = require("./page_runtime");
const { log } = require("./logger");

function openReportTabScript(reportType) {
  return `
(() => {
  const expectedType = ${JSON.stringify(reportType)};
  const collectDocuments = (rootDocument, result = []) => {
    result.push(rootDocument);
    for (const frame of [...rootDocument.querySelectorAll("iframe,frame")]) {
      try {
        if (frame.contentDocument) collectDocuments(frame.contentDocument, result);
      } catch (_) {}
    }
    return result;
  };
  const documents = collectDocuments(document);
  const pageDocument = documents.find((doc) => typeof doc.defaultView.setThreeColor === "function");
  if (!pageDocument) return { ok: false, message: "未找到电话明细菜单函数" };
  const textOf = (node) => String(node.innerText || node.value || node.textContent || "").trim().replace(/\\s+/g, "");
  const targetText = expectedType === "inbound" ? "呼入" : expectedType === "outbound" ? "呼出" : "呼损";
  const targetUrl = expectedType === "inbound" ? "inboundPage" : expectedType === "outbound" ? "outboundPage" : "inboundFailPage";
  const targetNode = [...pageDocument.querySelectorAll("span,a,li,div")]
    .find((node) => String(node.getAttribute("onclick") || "").includes(targetUrl)) ||
    [...pageDocument.querySelectorAll("span,a,li,div")].find((node) => textOf(node) === targetText);
  if (!targetNode) return { ok: false, message: "未找到目标页签" };
  if (expectedType === "inbound") {
    pageDocument.defaultView.setThreeColor("cdr!inboundPage.act?callType=CALL_IN", "1322", targetNode);
  } else if (expectedType === "outbound") {
    pageDocument.defaultView.setThreeColor("cdr!outboundPage.act?callType=CALL_OUT", "1323", targetNode);
  } else {
    pageDocument.defaultView.setThreeColor("cdr!inboundFailPage.act?callType=CALL_IN", "1324", targetNode);
  }
  return { ok: true, text: targetText };
})()
`;
}

function reportPageReadyScript(reportType = "") {
  const expectedType = reportType === "inbound" ? "inbound" : reportType === "outbound" ? "outbound" : reportType === "loss" ? "loss" : "";
  return `
(() => {
  const expectedType = ${JSON.stringify(expectedType)};
  const collectDocuments = (rootDocument, result = []) => {
    result.push(rootDocument);
    for (const frame of [...rootDocument.querySelectorAll("iframe,frame")]) {
      try {
        if (frame.contentDocument) collectDocuments(frame.contentDocument, result);
      } catch (_) {}
    }
    return result;
  };
  const documents = collectDocuments(document);
  const visible = (node) => {
    if (!node) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const normalize = (text) => String(text || "").replace(/\\s+/g, "");
  const reportScore = (doc) => {
    const body = String(doc.body && doc.body.innerText || "");
    const url = String(doc.location && doc.location.href || "");
    if (!expectedType) return 1;
    if (expectedType === "loss" && /inboundFailPage|CALL_FAIL/i.test(url)) return 100;
    if (expectedType === "inbound" && /inboundPage/i.test(url) && /CALL_IN/i.test(url) && !/inboundFailPage/i.test(url)) return 100;
    if (expectedType === "outbound" && /outboundPage/i.test(url) && /CALL_OUT/i.test(url)) return 100;
    if (expectedType === "loss" && body.includes("丢失位置") && body.includes("排队停留")) return 50;
    if (expectedType === "inbound" && !body.includes("丢失位置") && body.includes("通话时长")) return 40;
    if (expectedType === "outbound" && !body.includes("丢失位置") && (body.includes("被叫号码") || body.includes("呼出时间") || body.includes("拨打时间"))) return 40;
    return 0;
  };
  const reportDocuments = documents
    .map((doc) => ({ doc, score: reportScore(doc) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.doc);
  return reportDocuments.some((doc) => {
    const body = String(doc.body && doc.body.innerText || "");
    const hasTimeRange = body.includes("时间范围") || body.includes("来电时间") || body.includes("呼入时间") || body.includes("呼出时间") || body.includes("开始时间");
    const hasExport = [...doc.querySelectorAll("a,button,input[type='button'],span,div")]
      .some((node) => visible(node) && normalize(node.innerText || node.value || node.textContent).includes("导出"));
    return hasTimeRange && hasExport;
  });
})()
`;
}

async function openReportTab(cdp, sessionId, reportType) {
  const label = reportType === "inbound" ? "呼入" : reportType === "outbound" ? "呼出" : "呼损";
  log("切换页签", label);
  const tabPayload = await evaluate(cdp, sessionId, openReportTabScript(reportType));
  if (!tabPayload.ok) throw new Error(`切换${label}页签失败：${tabPayload.message || "未知原因"}`);
  await waitFor(cdp, sessionId, reportPageReadyScript(reportType), `${label}筛选和导出区域`, 30000);
}

module.exports = {
  openReportTab,
  reportPageReadyScript
};
