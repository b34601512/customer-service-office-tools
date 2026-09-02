// 该文件只负责从天猫服务质量报表下载中心取得当前报表文件。
const appConfig = require("../../../config/appConfig");
const { log } = require("../../../engine/logger");
const { wait, clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const { assertNoTmallSafetyChallenge } = require("../tmallSafetyGuard");
const {
  CUSTOMER_SATISFACTION_DETAIL_SHEET_TEXT,
  RESPONSE_TIME_DOWNLOAD_TITLE_TEXT,
  DOWNLOAD_CENTER_TEXT,
  DOWNLOAD_CENTER_TITLE_COLUMN_TEXT,
  DOWNLOAD_CENTER_ACTION_COLUMN_TEXT,
  DOWNLOAD_CENTER_DOWNLOAD_TEXT,
  DOWNLOAD_CENTER_DOWNLOAD_SELECTORS,
  escapeRegex,
  buildExactTextPattern,
  getTmallCustomerSatisfactionDetailButton,
  getTmallCustomerSatisfactionDrawer
} = require("./tmallResponseTimePageElements");
const {
  buildResponseTimeClickOptions,
  clickTmallResponseTimeExport
} = require("./tmallResponseTimeReportFlow");

function getTmallDownloadCenterEntry(page) {
  // 这里定位页面右上角下载中心，平均响应时间导出后必须从这里取真实文件。
  return page
    .locator("button, a, [role='button'], span")
    .filter({ hasText: buildExactTextPattern(DOWNLOAD_CENTER_TEXT), visible: true })
    .first();
}

function getTmallExportToastDownloadCenterEntry(page) {
  // 客户满意度导出后，平台提示里的下载中心链接不会被右上角账户浮层遮住。
  return page
    .locator("a")
    .filter({ hasText: buildExactTextPattern(DOWNLOAD_CENTER_TEXT), visible: true })
    .first();
}

function getTmallDownloadCenterSurface(page) {
  // 这里尽量限定到弹出的下载中心面板，避免误点页面顶部导航里的“下载”。
  return page
    .locator("[role='dialog'], .ant-modal, .next-dialog, .oui-dialog, [class*='modal'], [class*='Modal'], [class*='dialog'], [class*='Dialog']")
    .filter({ hasText: new RegExp(escapeRegex(DOWNLOAD_CENTER_TEXT)), visible: true })
    .last();
}

function getTmallDownloadCenterTableSurface(page) {
  // 千牛下载中心真实弹层没有稳定的弹窗 class，只能用表头和操作列锁定弹层里的下载表格。
  return page
    .locator("table")
    .filter({
      hasText: new RegExp(
        `${escapeRegex(DOWNLOAD_CENTER_TITLE_COLUMN_TEXT)}[\\s\\S]*${escapeRegex(DOWNLOAD_CENTER_ACTION_COLUMN_TEXT)}[\\s\\S]*${escapeRegex(DOWNLOAD_CENTER_DOWNLOAD_TEXT)}`
      ),
      visible: true
    })
    .last();
}

async function resolveTmallDownloadCenterSurface(page) {
  // 有些页面弹层没有标准 role，这里先找弹层容器，找不到再用下载中心表格兜住真实可点区域。
  const surface = getTmallDownloadCenterSurface(page);
  if ((await surface.count().catch(() => 0)) > 0 && (await surface.isVisible().catch(() => false))) {
    return surface;
  }
  const tableSurface = getTmallDownloadCenterTableSurface(page);
  if ((await tableSurface.count().catch(() => 0)) > 0 && (await tableSurface.isVisible().catch(() => false))) {
    return tableSurface;
  }
  return null;
}

async function findTmallDownloadButtonInSurface(surface) {
  // 下载中心里的“下载”在真实页面上可能只是蓝色 span 文本；优先点叶子元素，避免误点表格格子外壳。
  for (const selector of DOWNLOAD_CENTER_DOWNLOAD_SELECTORS) {
    const locator = surface
      .locator(selector)
      .filter({ hasText: buildExactTextPattern(DOWNLOAD_CENTER_DOWNLOAD_TEXT), visible: true })
      .first();
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }

  return surface
    .getByText(buildExactTextPattern(DOWNLOAD_CENTER_DOWNLOAD_TEXT))
    .filter({ visible: true })
    .first();
}

async function resolveTmallDownloadCenterRecordSurface(page, expectedTitleText = "") {
  // 下载中心会保留历史记录，必须按当前报表标题取行，不能默认取第一条最新记录。
  const surface = await resolveTmallDownloadCenterSurface(page);
  if (!surface) {
    throw new Error("未找到天猫下载中心弹窗，不能点击文件下载。");
  }

  const normalizedExpectedTitle = String(expectedTitleText || "").trim();
  if (!normalizedExpectedTitle) {
    return surface;
  }

  const titlePattern = new RegExp(escapeRegex(normalizedExpectedTitle));
  const row = surface.locator("tr, [role='row']").filter({ hasText: titlePattern, visible: true }).first();
  if ((await row.count().catch(() => 0)) > 0 && (await row.isVisible().catch(() => false))) {
    return row;
  }

  return null;
}

async function getTmallDownloadCenterLatestDownloadButton(page, expectedTitleText = "") {
  // 该函数只取得当前报表记录内的下载按钮。
  const recordSurface = await resolveTmallDownloadCenterRecordSurface(page, expectedTitleText);
  if (!recordSurface) {
    throw new Error(`天猫下载中心未找到当前报表记录：${expectedTitleText}`);
  }

  return findTmallDownloadButtonInSurface(recordSurface);
}

async function waitForTmallDownloadCenterReady(page, timeoutMs = appConfig.tmall.connectTimeoutMs, expectedTitleText = "") {
  // 这里等待下载中心弹窗和第一条下载记录都出现，避免导出任务还没生成就误判。
  const deadline = Date.now() + timeoutMs;
  let surfaceVisible = false;
  let titleVisible = false;
  let actionVisible = false;
  let downloadVisible = false;
  let recordVisible = false;

  log("主线:等待", "天猫平均响应时间", "下载中心就绪", "等待下载中心弹窗和最新下载记录出现");
  while (Date.now() <= deadline) {
    await assertNoTmallSafetyChallenge(page, "等待平均响应时间下载中心");
    const surface = await resolveTmallDownloadCenterSurface(page);
    surfaceVisible = Boolean(surface);
    if (surface) {
      titleVisible = await surface.locator("*").filter({ hasText: buildExactTextPattern(DOWNLOAD_CENTER_TITLE_COLUMN_TEXT), visible: true }).first().isVisible().catch(() => false);
      actionVisible = await surface.locator("*").filter({ hasText: buildExactTextPattern(DOWNLOAD_CENTER_ACTION_COLUMN_TEXT), visible: true }).first().isVisible().catch(() => false);
      const recordSurface = await resolveTmallDownloadCenterRecordSurface(page, expectedTitleText);
      recordVisible = Boolean(recordSurface);
      const downloadButton = recordSurface ? await findTmallDownloadButtonInSurface(recordSurface) : null;
      downloadVisible = downloadButton ? await downloadButton.isVisible().catch(() => false) : false;
      if (titleVisible && actionVisible && recordVisible && downloadVisible) {
        log("主线:完成", "天猫平均响应时间", "下载中心就绪", "已看到下载中心最新记录");
        return;
      }
    }
    await wait(Math.min(appConfig.tmall.pageReadyPollIntervalMs, Math.max(1, deadline - Date.now())));
  }

  throw new Error(
    `等待平均响应时间下载中心超时：弹窗=${surfaceVisible ? "已出现" : "未出现"}，标题列=${titleVisible ? "已出现" : "未出现"}，操作列=${actionVisible ? "已出现" : "未出现"}，当前记录=${recordVisible ? "已出现" : "未出现"}，下载按钮=${downloadVisible ? "已出现" : "未出现"}，期望记录=${expectedTitleText || "未限定"}。`
  );
}

async function waitForTmallCustomerSatisfactionDrawerReady(page, timeoutMs = appConfig.tmall.connectTimeoutMs) {
  // 这里等待满意度右侧明细抽屉和导出按钮出现，防止点到背景页按钮。
  const deadline = Date.now() + timeoutMs;
  let drawerVisible = false;
  let exportVisible = false;
  while (Date.now() <= deadline) {
    const drawer = getTmallCustomerSatisfactionDrawer(page);
    drawerVisible = await drawer.isVisible().catch(() => false);
    if (drawerVisible) {
      exportVisible = await drawer
        .locator("button, a, span")
        .filter({ hasText: buildExactTextPattern("导出"), visible: true })
        .first()
        .isVisible()
        .catch(() => false);
      if (exportVisible) {
        return drawer;
      }
    }
    await wait(Math.min(appConfig.tmall.pageReadyPollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`等待天猫满意度明细抽屉超时：抽屉=${drawerVisible ? "已出现" : "未出现"}，导出=${exportVisible ? "已出现" : "未出现"}。`);
}

async function clickTmallDownloadCenterEntry(page, options = {}) {
  // 这里打开下载中心弹窗，平台导出只是生成任务，真实文件必须在弹窗里点下载。
  await assertNoTmallSafetyChallenge(page, "打开平均响应时间下载中心前");
  const downloadCenterEntry = getTmallDownloadCenterEntry(page);
  const actionName = "平均响应时间下载中心入口";
  const clickOptions = buildResponseTimeClickOptions(options);
  log("主线:执行", "天猫平均响应时间", "打开下载中心", "按唯一可见入口点击下载中心");
  await clickLocatorWhenReady(downloadCenterEntry, actionName, clickOptions);
}

async function clickTmallExportToastDownloadCenterEntry(page, options = {}) {
  // 客户满意度只跟随导出成功提示的下载中心链接，不再关闭抽屉后点击右上角入口。
  await assertNoTmallSafetyChallenge(page, "打开客户满意度下载中心前");
  const downloadCenterEntry = getTmallExportToastDownloadCenterEntry(page);
  const actionName = "客户满意度导出提示下载中心入口";
  const clickOptions = buildResponseTimeClickOptions(options);
  log("主线:执行", "天猫客户满意度", "打开下载中心", "点击导出成功提示里的下载中心");
  await clickLocatorWhenReady(downloadCenterEntry, actionName, clickOptions);
}

async function clickTmallDownloadCenterLatestDownload(page, options = {}) {
  // 这里只按下载中心最新记录里的唯一下载元素点击，避免坐标点到相邻内容。
  const downloadButton = await getTmallDownloadCenterLatestDownloadButton(page, options.expectedTitleText);
  const actionName = "平均响应时间下载中心最新记录";
  const clickOptions = buildResponseTimeClickOptions(options);
  log("主线:执行", "天猫平均响应时间", "点击最新下载记录", "按唯一可见下载按钮点击");
  await clickLocatorWhenReady(downloadButton, actionName, clickOptions);
}

async function triggerTmallResponseTimeDownload(page, options = {}) {
  // 这里串起平均响应时间真实下载闭环：导出 -> 下载中心 -> 最新记录下载。
  const timeoutMs = options.timeoutMs || appConfig.tmall.connectTimeoutMs;
  const expectedTitleText = RESPONSE_TIME_DOWNLOAD_TITLE_TEXT;
  await clickTmallResponseTimeExport(page, options);
  await clickTmallDownloadCenterEntry(page, options);
  await waitForTmallDownloadCenterReady(page, timeoutMs, expectedTitleText);
  await clickTmallDownloadCenterLatestDownload(page, { ...options, expectedTitleText });
}

async function triggerTmallCustomerSatisfactionDownload(page, options = {}) {
  // 满意度真实闭环：点击旺旺满意度明细 -> 抽屉导出 -> 关闭抽屉 -> 下载中心取文件。
  const timeoutMs = options.timeoutMs || appConfig.tmall.connectTimeoutMs;
  const expectedTitleText = CUSTOMER_SATISFACTION_DETAIL_SHEET_TEXT;
  await clickLocatorWhenReady(getTmallCustomerSatisfactionDetailButton(page), "旺旺满意度明细入口", buildResponseTimeClickOptions(options));
  const drawer = await waitForTmallCustomerSatisfactionDrawerReady(page, timeoutMs);
  const exportButton = drawer
    .locator("button, a, span")
    .filter({ hasText: buildExactTextPattern("导出"), visible: true })
    .first();
  await clickLocatorWhenReady(exportButton, "旺旺满意度明细导出按钮", buildResponseTimeClickOptions(options));
  await clickTmallExportToastDownloadCenterEntry(page, options);
  await waitForTmallDownloadCenterReady(page, timeoutMs, expectedTitleText);
  await clickTmallDownloadCenterLatestDownload(page, { ...options, expectedTitleText });
}

module.exports = {
  triggerTmallResponseTimeDownload,
  triggerTmallCustomerSatisfactionDownload
};
