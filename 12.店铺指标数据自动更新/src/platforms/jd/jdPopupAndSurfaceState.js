const {
  dismissBlockingPopups,
  runAfterDismissingBlockingPopups
} = require("../../shared/blockingPopupEngine");
const { getJdDateRangeEditors, getJdExportButton, getJdSearchButton } = require("./jdControls");
const { hasJdSessionExpiredText, isJdPassportLoginUrl } = require("./jdLoginPageClassifier");
const { JD_EXPIRED_SESSION_LOGIN_BUTTON_SELECTORS } = require("./loginSurfaceParts/jdLoginSurfaceLocator");
const { detectJdManualVerification } = require("./loginSurfaceParts/jdLoginSurfaceState");
const jdBusinessPopupDialogSelectors = [".win-notice-modal"];
const jdBusinessPopupCloseSelectors = [".close-modal"];

async function readSurfaceBodyText(surface) {
  // 该函数只读取当前操作面的正文文本。
  const body = surface.locator("body").first();
  if ((await body.count()) === 0) {
    return "";
  }
  return String(await body.innerText()).replace(/\s+/g, " ").trim();
}

function createJdBlockingPopupOptions(options = {}) {
  // 该函数只合并京东专用弹层结构，通用弹窗规则继续由底层引擎维护。
  return {
    ...options,
    platformName: "京东",
    additionalDialogSelectors: [
      ...(options.additionalDialogSelectors || []),
      ...jdBusinessPopupDialogSelectors
    ],
    additionalCloseSelectors: [
      ...(options.additionalCloseSelectors || []),
      ...jdBusinessPopupCloseSelectors
    ],
    shouldPreserveSurface: shouldPreserveJdPageForManualVerification
  };
}

async function attemptDismissJdPopup(surface, options = {}) {
  // 该函数只关闭当前京东操作面中唯一明确的关闭入口。
  return (await dismissBlockingPopups(surface, createJdBlockingPopupOptions(options))) > 0;
}

async function runAfterDismissingJdPopups(surface, action, options = {}) {
  // 该函数只在京东普通弹窗治理后执行动作，安全验证页面保持原样交给人工处理。
  return runAfterDismissingBlockingPopups(
    surface,
    action,
    createJdBlockingPopupOptions(options)
  );
}

function isJdBusinessPage(page) {
  // 登录页必须保持原样，账号填写、安全验证均由登录辅助流程单独处理。
  const currentUrl = String(page.url?.() || "");
  return /^https?:\/\/(?:[^/]+\.)?jd\.com/i.test(currentUrl) && !isJdPassportLoginUrl(currentUrl);
}

async function shouldPreserveJdPageForManualVerification(page) {
  // 安全验证可能出现在业务域名或内嵌页面，识别后整页保持原样等待用户。
  return Boolean(await detectJdManualVerification(page));
}

async function stabilizeJdBrowser(browser) {
  // 该函数只治理普通业务弹窗；登录页和安全验证页永远不尝试关闭。
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!isJdBusinessPage(page) || await shouldPreserveJdPageForManualVerification(page)) {
        continue;
      }
      for (const surface of page.frames()) {
        await attemptDismissJdPopup(surface);
      }
    }
  }
}

async function hasVisibleJdExpiredSessionDialog(surface) {
  // 该函数只判断登录过期弹窗是否可见，不点击登录按钮；选择器与点击链路共用同一份清单。
  for (const selector of JD_EXPIRED_SESSION_LOGIN_BUTTON_SELECTORS) {
    const locator = surface.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      return true;
    }
  }
  return false;
}

async function isJdReportSurfaceReady(surface) {
  // 该函数只确认京东报表的查询、导出和日期控件已就绪。
  if (await hasVisibleJdExpiredSessionDialog(surface)) {
    return false;
  }
  const searchCount = await getJdSearchButton(surface).count();
  const exportCount = await getJdExportButton(surface).count();
  const dateEditorCount = await getJdDateRangeEditors(surface).count();
  if (searchCount > 0 && exportCount > 0 && dateEditorCount > 0) {
    return true;
  }
  const bodyText = await readSurfaceBodyText(surface);
  if (hasJdSessionExpiredText(bodyText)) {
    return false;
  }
  return false;
}

module.exports = {
  attemptDismissJdPopup,
  runAfterDismissingJdPopups,
  stabilizeJdBrowser,
  isJdBusinessPage,
  shouldPreserveJdPageForManualVerification,
  readSurfaceBodyText,
  isJdReportSurfaceReady
};
