// 该文件只负责识别天猫服务质量报表页面的真实文本和元素。

// escapeRegex 统一取自 shared/visibleButtonActionEngine 单一真源（#603），并继续对外导出供 downloadCenter 引用。
const { escapeRegex } = require("../../../shared/visibleButtonActionEngine");

const TMALL_RESPONSE_TIME_REPORT_URL = "https://qn.taobao.com/home.html/voc-tmall/serverReport";
const TMALL_RESPONSE_TIME_REPORT_ANALYSIS_URL = "https://qn.taobao.com/home.html/voc-tmall/serverReport-analysis";
const SERVICE_EXPERIENCE_ANALYSIS_TEXT = "服务体验分析";
const RESPONSE_TIME_METRIC_TEXT = "旺旺人工平响时长";
const CUSTOMER_SATISFACTION_DETAIL_SHEET_TEXT = "旺旺账号咨询接待能力明细";
const RESPONSE_TIME_DOWNLOAD_TITLE_TEXT = "按客服查看";
const RESPONSE_TIME_RESULT_COLUMN_TEXT = "平均响应时长";
const RESPONSE_TIME_EXPORT_TEXT = "导出";
const DOWNLOAD_CENTER_TEXT = "下载中心";
const DOWNLOAD_CENTER_TITLE_COLUMN_TEXT = "下载数据标题";
const DOWNLOAD_CENTER_ACTION_COLUMN_TEXT = "操作";
const DOWNLOAD_CENTER_DOWNLOAD_TEXT = "下载";
const DOWNLOAD_CENTER_DOWNLOAD_SELECTORS = ["a", "button", "[role='button']", "span", "div", "td"];
const RESPONSE_TIME_LOGIN_READY_TEXTS = [
  "真实体检分",
  "店铺表现",
  "指标表现",
  DOWNLOAD_CENTER_TEXT,
  SERVICE_EXPERIENCE_ANALYSIS_TEXT
];

function buildExactTextPattern(text) {
  // 该函数只生成允许首尾空白的完整文本匹配规则。
  return new RegExp(`^\\s*${escapeRegex(text)}\\s*$`);
}

function getClickableTextLocator(page, text) {
  // 该函数只从可点击元素中定位完整文案。
  const exactPattern = buildExactTextPattern(text);
  return page
    .locator("button, a, [role='tab'], [role='button'], [class*='tab'], [class*='Tab'], [class*='item'], [class*='Item']")
    .filter({ hasText: exactPattern, visible: true })
    .first();
}

function getVisibleTextLocator(page, text) {
  // 该函数只定位页面中第一个可见的完整文案。
  return page.getByText(buildExactTextPattern(text)).filter({ visible: true }).first();
}

async function resolveClickableTextLocator(page, text) {
  // 页面里经常同时存在隐藏副本和可见页签，所以必须先筛可见节点再取第一个。
  const clickableLocator = getClickableTextLocator(page, text);
  if ((await clickableLocator.count().catch(() => 0)) > 0) {
    return clickableLocator;
  }
  return getVisibleTextLocator(page, text);
}

async function hasVisibleClickableText(page, text) {
  // 这里只判断是否存在可见入口，避免隐藏副本让流程误判不可见。
  const clickableLocator = getClickableTextLocator(page, text);
  if ((await clickableLocator.count().catch(() => 0)) > 0 && (await clickableLocator.isVisible().catch(() => false))) {
    return true;
  }
  const textLocator = getVisibleTextLocator(page, text);
  return (await textLocator.count().catch(() => 0)) > 0 && (await textLocator.isVisible().catch(() => false));
}

async function getTmallServiceExperienceAnalysisEntry(page) {
  // 这里定位真实体检分顶部的“服务体验分析”入口，这是平均响应时间的真实上游入口。
  return resolveClickableTextLocator(page, SERVICE_EXPERIENCE_ANALYSIS_TEXT);
}

async function getTmallResponseTimeMetricEntry(page) {
  // 这里定位服务体验分析内部的“旺旺人工平响时长”，它才是平均响应时间报表入口。
  return resolveClickableTextLocator(page, RESPONSE_TIME_METRIC_TEXT);
}

function getTmallResponseTimeDataSignal(page) {
  // 这里用报表表头确认已经进入平均响应时间数据页，避免只看到页签就误判成功。
  return getVisibleTextLocator(page, RESPONSE_TIME_RESULT_COLUMN_TEXT);
}

function getTmallResponseTimeExportButton(page) {
  // 真实页面有多个“导出”，下方的是超60秒会话明细；平均响应时间必须取上方主表导出。
  return page
    .locator("button")
    .filter({ hasText: buildExactTextPattern(RESPONSE_TIME_EXPORT_TEXT), visible: true })
    .first();
}

function getTmallCustomerSatisfactionDetailButton(page) {
  // 旺旺满意度明细入口在指定指标行内，限定容器可避免点到别的“明细”。
  return page
    .locator('[id="metricsNameContainer-旺旺满意度"]')
    .locator("a, button, span")
    .filter({ hasText: buildExactTextPattern("明细"), visible: true })
    .first();
}

function getTmallCustomerSatisfactionDrawer(page) {
  // 满意度明细会从右侧抽屉打开，后续导出必须限定在抽屉内部。
  return page
    .locator("[role='dialog'], .next-drawer, [class*='drawer'], [class*='Drawer']")
    .filter({ hasText: new RegExp(escapeRegex(CUSTOMER_SATISFACTION_DETAIL_SHEET_TEXT)), visible: true })
    .last();
}

module.exports = {
  TMALL_RESPONSE_TIME_REPORT_URL,
  TMALL_RESPONSE_TIME_REPORT_ANALYSIS_URL,
  SERVICE_EXPERIENCE_ANALYSIS_TEXT,
  RESPONSE_TIME_METRIC_TEXT,
  CUSTOMER_SATISFACTION_DETAIL_SHEET_TEXT,
  RESPONSE_TIME_DOWNLOAD_TITLE_TEXT,
  RESPONSE_TIME_RESULT_COLUMN_TEXT,
  RESPONSE_TIME_EXPORT_TEXT,
  DOWNLOAD_CENTER_TEXT,
  DOWNLOAD_CENTER_TITLE_COLUMN_TEXT,
  DOWNLOAD_CENTER_ACTION_COLUMN_TEXT,
  DOWNLOAD_CENTER_DOWNLOAD_TEXT,
  DOWNLOAD_CENTER_DOWNLOAD_SELECTORS,
  RESPONSE_TIME_LOGIN_READY_TEXTS,
  escapeRegex,
  buildExactTextPattern,
  getVisibleTextLocator,
  resolveClickableTextLocator,
  hasVisibleClickableText,
  getTmallServiceExperienceAnalysisEntry,
  getTmallResponseTimeMetricEntry,
  getTmallResponseTimeDataSignal,
  getTmallResponseTimeExportButton,
  getTmallCustomerSatisfactionDetailButton,
  getTmallCustomerSatisfactionDrawer
};
