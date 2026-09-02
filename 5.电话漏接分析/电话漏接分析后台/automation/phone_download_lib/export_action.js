const fs = require("fs");
const path = require("path");
const { evaluate } = require("./page_runtime");
const { log } = require("./logger");
const { sleep } = require("./timing");

function reportFileLabel(reportType) {
  // 统一报表名称，避免下载、验收、分析各写一套文件名规则。
  if (reportType === "inbound") return "呼入明细";
  if (reportType === "outbound") return "呼出明细";
  return "呼损明细";
}

function expectedReportFile(config, reportType) {
  // 按页面导出的默认文件名定位目标文件，同时允许浏览器生成重复编号文件。
  const fileLabel = reportFileLabel(reportType);
  const dateRangeText = `${config.startDate.replace(/-/g, "")}--${config.endDate.replace(/-/g, "")}`;
  const baseName = `${fileLabel}(${dateRangeText})`;
  return {
    baseName,
    fileName: `${baseName}.xls`
  };
}

function escapeRegExp(text) {
  // 文件名里有括号，必须先转义再构造重复下载匹配规则。
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exportByPageFunctionScript(reportType) {
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
  const targetDocument = documents.find((doc) => {
    const pageWindow = doc.defaultView;
    const hasExportFunction = expectedType === "loss"
      ? typeof pageWindow.cdrFailExport === "function"
      : typeof pageWindow.cdrExport === "function";
    return hasExportFunction && reportScore(doc) > 0;
  });
  if (!targetDocument) return { ok: false, message: "未找到页面导出函数" };
  if (expectedType === "loss") {
    targetDocument.defaultView.cdrFailExport();
  } else {
    targetDocument.defaultView.cdrExport();
  }
  return {
    ok: true,
    title: String(targetDocument.title || ""),
    href: String(targetDocument.location && targetDocument.location.href || "")
  };
})()
`;
}

function listFinishedReportFiles(config, reportType, startedAtMs) {
  // 只接受本次导出后生成的完整 Excel，避免误用历史文件。
  const { baseName } = expectedReportFile(config, reportType);
  const fileNamePattern = new RegExp(`^${escapeRegExp(baseName)}( \\(\\d+\\))?\\.xlsx?$`, "i");
  if (!fs.existsSync(config.downloadDir)) return [];
  return fs.readdirSync(config.downloadDir)
    .filter((fileName) => fileNamePattern.test(fileName))
    .map((fileName) => {
      const fullPath = path.join(config.downloadDir, fileName);
      const stat = fs.statSync(fullPath);
      return { fullPath, fileName, size: stat.size, mtimeMs: stat.mtimeMs, isFile: stat.isFile() };
    })
    .filter((file) => file.isFile && file.size >= 128 && file.mtimeMs >= startedAtMs - 1000)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function isExcelFile(fullPath) {
  // 同时兼容旧版 xls 和新版 xlsx，防止 HTML 错误页伪装成下载结果。
  const handle = fs.openSync(fullPath, "r");
  try {
    const buffer = Buffer.alloc(4);
    fs.readSync(handle, buffer, 0, buffer.length, 0);
    const signature = buffer.toString("hex");
    return signature === "d0cf11e0" || signature === "504b0304";
  } finally {
    fs.closeSync(handle);
  }
}

async function waitForDownloadedReport(config, reportType, startedAtMs) {
  // 等浏览器把文件真正写完，而不是靠固定时间猜测下载是否完成。
  const label = reportFileLabel(reportType);
  const { fileName } = expectedReportFile(config, reportType);
  const deadline = Date.now() + config.downloadWaitMs;
  const seenSizes = new Map();
  let lastProgressAt = 0;

  while (Date.now() < deadline) {
    const candidates = listFinishedReportFiles(config, reportType, startedAtMs);
    for (const candidate of candidates) {
      const previousSize = seenSizes.get(candidate.fullPath);
      seenSizes.set(candidate.fullPath, candidate.size);
      if (previousSize === candidate.size && isExcelFile(candidate.fullPath)) {
        log("下载验收", `${label} 文件=${candidate.fileName} 大小=${candidate.size}`);
        return candidate.fullPath;
      }
    }

    if (Date.now() - lastProgressAt > 10000) {
      lastProgressAt = Date.now();
      log("下载等待", `${label} 目标=${fileName} 已发现=${candidates.length}`);
    }
    await sleep(500);
  }

  throw new Error(`${label}导出下载超时：${config.downloadWaitMs}ms 内没有生成完整 Excel 文件。`);
}

async function downloadByPageExport(cdp, sessionId, config, reportType) {
  const label = reportFileLabel(reportType);
  const startedAtMs = Date.now();
  const exportPayload = await evaluate(cdp, sessionId, exportByPageFunctionScript(reportType));
  if (!exportPayload.ok) throw new Error(exportPayload.message || `${label}导出函数执行失败。`);
  log("页面导出", `${label} title=${exportPayload.title || "空"} href=${exportPayload.href || "空"}`);
  return await waitForDownloadedReport(config, reportType, startedAtMs);
}

module.exports = { downloadByPageExport };
