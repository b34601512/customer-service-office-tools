const appConfig = require("../../../config/appConfig");
const { normalizeCompactDate } = require("./tmallReportPayloadParser");

const queryDateApiToken = "mtop.alibaba.tmall.query.date";
const storeIndexApiToken = "mtop.alibaba.tmall.front.store.index";
const summaryApiToken = "mtop.sdx.nps.home.indexsummary";

function parseJsonpBody(bodyText) {
  const text = String(bodyText || "").trim();
  const firstParenthesis = text.indexOf("(");
  const lastParenthesis = text.lastIndexOf(")");
  const jsonText = firstParenthesis >= 0 && lastParenthesis > firstParenthesis
    ? text.slice(firstParenthesis + 1, lastParenthesis)
    : text;
  return JSON.parse(jsonText);
}

function parseNestedJson(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || "{}"));
  } catch (_error) {
    return {};
  }
}

function parseMtopRequestData(responseUrl) {
  try {
    const requestUrl = new URL(responseUrl);
    const requestData = parseNestedJson(requestUrl.searchParams.get("data"));
    return {
      ...requestData,
      params: parseNestedJson(requestData.params)
    };
  } catch (_error) {
    return { params: {} };
  }
}

async function readMtopResponse(response) {
  const responseText = await response.text();
  const payload = parseJsonpBody(responseText);
  const successText = Array.isArray(payload?.ret) ? payload.ret.join("|") : String(payload?.ret || "");
  if (!/SUCCESS/i.test(successText)) {
    throw new Error(`天猫页面接口返回失败：${successText || "未知原因"}`);
  }
  return {
    payload,
    requestData: parseMtopRequestData(response.url())
  };
}

function selectCandidateByDate(candidates, targetCompactDate, candidateDateResolver) {
  return candidates.find((candidate) =>
    String(candidateDateResolver(candidate) || "").replace(/-/g, "") === targetCompactDate) || null;
}

async function applyManualSnapshotDate(page, snapshotDate) {
  const dateInput = page.locator('input[placeholder="选择日期"]').first();
  await dateInput.waitFor({ state: "visible", timeout: 30000 });
  await dateInput.fill(snapshotDate);
  await dateInput.press("Enter");
  await dateInput.blur().catch(() => {});
  const selectedDate = await dateInput.inputValue();
  if (selectedDate !== snapshotDate) {
    throw new Error(`天猫手动日期未生效：期望 ${snapshotDate}，页面为 ${selectedDate || "空"}。`);
  }
}

async function captureTmallReportPayloads(page, dateSelection, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 60000);
  const dateCandidates = [];
  const indicatorCandidates = [];
  const summaryCandidates = [];
  const responseTasks = new Set();

  function handleResponse(response) {
    const responseUrlLowerCase = response.url().toLowerCase();
    if (![queryDateApiToken, storeIndexApiToken, summaryApiToken]
      .some((apiToken) => responseUrlLowerCase.includes(apiToken.toLowerCase()))) return;
    const responseTask = readMtopResponse(response).then((candidate) => {
      if (responseUrlLowerCase.includes(queryDateApiToken)) dateCandidates.push(candidate);
      if (responseUrlLowerCase.includes(storeIndexApiToken) &&
        candidate.payload?.data?.componentId === "tmallStoreIndicators") {
        indicatorCandidates.push(candidate);
      }
      if (responseUrlLowerCase.includes(summaryApiToken)) summaryCandidates.push(candidate);
    }).catch(() => {});
    responseTasks.add(responseTask);
    responseTask.finally(() => responseTasks.delete(responseTask));
  }

  page.on("response", handleResponse);
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: appConfig.tmall.connectTimeoutMs });
    if (dateSelection?.mode === "manual" && dateSelection?.snapshotDate) {
      await applyManualSnapshotDate(page, dateSelection.snapshotDate);
    }
    const deadline = Date.now() + timeoutMs;
    let captureResult = null;
    while (Date.now() <= deadline) {
      await Promise.allSettled([...responseTasks]);
      const latestDateSource = dateCandidates.at(-1)?.payload?.data?.dataSource || {};
      const targetDataDate = dateSelection?.mode === "manual"
        ? normalizeCompactDate(dateSelection.snapshotDate)
        : normalizeCompactDate(latestDateSource.endDate);
      const targetCompactDate = targetDataDate.replace(/-/g, "");
      const indicatorCandidate = selectCandidateByDate(
        indicatorCandidates,
        targetCompactDate,
        (candidate) => candidate.requestData?.params?.endDate
      );
      const summaryCandidate = selectCandidateByDate(
        summaryCandidates,
        targetCompactDate,
        (candidate) => candidate.requestData?.updateDate
      );
      if (targetCompactDate && indicatorCandidate && summaryCandidate) {
        captureResult = {
          dataDate: targetDataDate,
          statisticsStartDate: normalizeCompactDate(indicatorCandidate.requestData.params.startDate),
          statisticsEndDate: normalizeCompactDate(indicatorCandidate.requestData.params.endDate),
          indicatorData: indicatorCandidate.payload.data.dataSource,
          summaryData: summaryCandidate.payload.data.data,
          captureMethod: "页面接口"
        };
        break;
      }
      await page.waitForTimeout(300);
    }
    return captureResult;
  } finally {
    page.off("response", handleResponse);
  }
}

module.exports = {
  queryDateApiToken,
  storeIndexApiToken,
  summaryApiToken,
  parseJsonpBody,
  parseMtopRequestData,
  applyManualSnapshotDate,
  captureTmallReportPayloads
};
