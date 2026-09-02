const { evaluate, waitFor } = require("./page_runtime");
const { log } = require("./logger");
const { reportPageReadyScript } = require("./report_tab_action");

function reportScoreScript() {
  return `
  const reportScore = (doc) => {
    const body = String(doc.body && doc.body.innerText || "");
    const url = String(doc.location && doc.location.href || "");
    if (expectedType === "loss" && /inboundFailPage|CALL_FAIL/i.test(url)) return 100;
    if (expectedType === "inbound" && /inboundPage/i.test(url) && /CALL_IN/i.test(url) && !/inboundFailPage/i.test(url)) return 100;
    if (expectedType === "outbound" && /outboundPage/i.test(url) && /CALL_OUT/i.test(url)) return 100;
    if (expectedType === "loss" && body.includes("丢失位置") && body.includes("排队停留")) return 50;
    if (expectedType === "inbound" && !body.includes("丢失位置") && body.includes("通话时长")) return 40;
    if (expectedType === "outbound" && !body.includes("丢失位置") && (body.includes("被叫号码") || body.includes("呼出时间") || body.includes("拨打时间"))) return 40;
    return 0;
  };
`;
}

function dateOnlyScript(config, reportType) {
  const start = `${config.startDate} 00:00:00`;
  const end = `${config.endDate} 23:59:59`;
  return `
(() => {
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
  const expectedType = ${JSON.stringify(reportType)};
  const visible = (node) => {
    if (!node) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const setValue = (node, value) => {
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.blur();
  };
  ${reportScoreScript()}
  const targetDocument = documents
    .map((doc) => ({ doc, score: reportScore(doc) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.doc;
  if (!targetDocument) return { ok: false, message: "未找到当前报表页签" };
  const inputs = [...targetDocument.querySelectorAll("input[type='text'],input:not([type])")].filter(visible);
  const dateInputs = inputs.filter((input) => /\\d{4}-\\d{2}-\\d{2}|时间|date|time/i.test(input.value + " " + input.id + " " + input.name + " " + input.className));
  if (dateInputs[0]) setValue(dateInputs[0], ${JSON.stringify(start)});
  if (dateInputs[1]) setValue(dateInputs[1], ${JSON.stringify(end)});
  const selects = [...targetDocument.querySelectorAll("select")].filter(visible);
  if (selects[0] && ${JSON.stringify(reportType)} === "loss") {
    selects[0].value = "";
    selects[0].dispatchEvent(new Event("change", { bubbles: true }));
  }
  const active = targetDocument.activeElement;
  if (active && typeof active.blur === "function") active.blur();
  return {
    ok: true,
    dateInputs: dateInputs.length,
    start: ${JSON.stringify(start)},
    end: ${JSON.stringify(end)},
    href: String(targetDocument.location && targetDocument.location.href || "")
  };
})()
`;
}

function dateRangeAppliedScript(config, reportType) {
  const start = `${config.startDate} 00:00:00`;
  const end = `${config.endDate} 23:59:59`;
  return `
(() => {
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
  const expectedType = ${JSON.stringify(reportType)};
  const visible = (node) => {
    if (!node) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  ${reportScoreScript()}
  const targetDocument = documents
    .map((doc) => ({ doc, score: reportScore(doc) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.doc;
  if (!targetDocument) return { ok: false, message: "未找到当前报表页签" };
  const inputs = [...targetDocument.querySelectorAll("input[type='text'],input:not([type])")].filter(visible);
  const dateInputs = inputs.filter((input) => /\\d{4}-\\d{2}-\\d{2}|时间|date|time/i.test(input.value + " " + input.id + " " + input.name + " " + input.className));
  const values = dateInputs.map((input) => String(input.value || "").trim());
  const startOk = values.some((value) => value.includes(${JSON.stringify(start)}) || value.includes(${JSON.stringify(config.startDate)}));
  const endOk = values.some((value) => value.includes(${JSON.stringify(end)}) || value.includes(${JSON.stringify(config.endDate)}));
  return { ok: startOk && endOk, values, href: String(targetDocument.location && targetDocument.location.href || "") };
})()
`;
}

async function applyDateRange(cdp, sessionId, config, reportType) {
  log("设置日期", `${config.startDate} 至 ${config.endDate}`);
  const datePayload = await evaluate(cdp, sessionId, dateOnlyScript(config, reportType));
  if (!datePayload.ok) throw new Error(`设置日期失败：${datePayload.message || "当前报表页签不可用"}`);
  log("日期写入", `${reportType} 输入框=${datePayload.dateInputs || 0} 直接导出=true`);
  await waitFor(cdp, sessionId, `(${dateRangeAppliedScript(config, reportType)}).ok === true`, "日期范围验收", 15000);
  await waitFor(cdp, sessionId, reportPageReadyScript(reportType), "设置日期后导出按钮", 30000);
}

module.exports = {
  applyDateRange,
  dateOnlyScript,
  dateRangeAppliedScript
};
