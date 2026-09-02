const { log } = require("../../engine/logger");
const { attachDownloadEvidenceFiles } = require("../../shared/taskHistoryParts/taskHistoryEvidenceBinder");
const { findReusableSummarySourceFile } = require("../summarySourceReuse");
const { listExistingEvidenceFiles } = require("../summaryEvidenceHistory");
const { notifyStoreProgress } = require("./summaryProgress");
const { downloadSummarySource } = require("./summarySourceDownloader");

function attachSourceReportKeysToEvidenceFiles(evidenceFiles, reportKeys) {
  // 这个函数只给凭证绑定本次真实下载来源，凭证数量由下载截图数量决定。
  const normalizedReportKeys = [...new Set(
    (Array.isArray(reportKeys) ? reportKeys : []).map((key) => String(key || "").trim()).filter(Boolean)
  )];
  return (Array.isArray(evidenceFiles) ? evidenceFiles : []).map((item) => ({
    ...item,
    sourceReportKeys: normalizedReportKeys
  }));
}

function findReusableSummarySourceRecord(input) {
  // 这个函数只按当前店铺、日期和全部目标报表寻找可复用源文件。
  const findReusableSource = input.findReusableSource || findReusableSummarySourceFile;
  const lookup = {
    platformKey: input.task.platformKey,
    storeKey: input.task.storeKey,
    reportKeys: [...new Set([...input.sourceGroup.reuseReportKeys, input.sourceGroup.downloadReportKey])],
    requiredReportKeys: input.sourceGroup.reportKeys,
    dateRange: input.dateRange,
    workbookPath: input.reportContexts[0]?.resolvedConfig?.workbook?.path
  };
  if (input.history) {
    lookup.history = input.history;
  }
  if (input.now !== undefined) {
    lookup.now = input.now;
  }
  if (input.nowFn !== undefined) {
    lookup.nowFn = input.nowFn;
  }
  if (typeof input.onReuseDecision === "function") {
    lookup.onReuseDecision = input.onReuseDecision;
  }
  return findReusableSource(lookup);
}

function buildReusableSourceResult(input, reusableRecord) {
  // 这个函数只恢复已有源文件及其明确绑定的现存凭证。
  const existingEvidenceFiles = listExistingEvidenceFiles(reusableRecord.evidenceFiles);
  const evidenceFiles = attachSourceReportKeysToEvidenceFiles(existingEvidenceFiles, input.sourceGroup.reportKeys);
  log(
    "主线:复用",
    "批量汇总",
    "取得源文件",
    `店铺=${input.task.storeDisplayName}，源文件=${reusableRecord.filePath}，理由=${reusableRecord.reuseDecisionReason || "历史源表已完整入库"}`
  );
  notifyStoreProgress(input.task, input.onTaskProgress, {
    status: "running",
    action: "复用源文件",
    detail: `已存在匹配文件，不再下载：${reusableRecord.filePath}`,
    sourceFiles: input.sourceFiles
  });
  return {
    filePath: reusableRecord.filePath,
    reused: true,
    // 新模型下"今天下载且文件存在"即可复用并重新导入，不再依赖历史导入记录。
    alreadyImported: true,
    evidenceFiles
  };
}

async function acquireNewSummarySource(input) {
  // 这个函数只执行新下载，并把本次新增凭证绑定到下载历史。
  const evidenceStartIndex = input.evidenceFiles.length;
  const downloadSource = input.downloadSummarySource || downloadSummarySource;
  const filePath = await downloadSource(input);
  const evidenceFiles = attachSourceReportKeysToEvidenceFiles(
    input.evidenceFiles.slice(evidenceStartIndex),
    input.sourceGroup.reportKeys
  );
  input.evidenceFiles.splice(evidenceStartIndex, evidenceFiles.length, ...evidenceFiles);
  const saveDownloadEvidence = input.attachDownloadEvidenceFiles || attachDownloadEvidenceFiles;
  saveDownloadEvidence(filePath, evidenceFiles);
  return { filePath, reused: false, alreadyImported: false, evidenceFiles };
}

function shouldReuseSummarySourceRecord(reusableRecord) {
  // 这个函数只允许存在且是"今天下载可复用"的源文件进入复用路径，否则重新下载。
  return Boolean(reusableRecord?.filePath);
}

async function acquireSummarySource(input) {
  // 这个函数只执行“已成功汇总的源文件复用，否则重新下载”的唯一规则。
  const reusableRecord = input.reusableRecord ||
    (input.forceRedownload === true ? null : findReusableSummarySourceRecord(input));
  return input.forceRedownload !== true && shouldReuseSummarySourceRecord(reusableRecord)
    ? buildReusableSourceResult(input, reusableRecord)
    : acquireNewSummarySource(input);
}

module.exports = {
  acquireSummarySource,
  findReusableSummarySourceRecord,
  shouldReuseSummarySourceRecord
};
