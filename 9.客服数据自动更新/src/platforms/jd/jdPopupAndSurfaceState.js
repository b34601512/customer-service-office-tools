const { dismissBlockingPopups } = require("../../shared/blockingPopupEngine");
const { getJdDateRangeEditors, getJdExportButton, getJdSearchButton } = require("./jdControls");
const {
  hasJdSessionExpiredText,
  hasJdLoginOrVerificationText,
  isJdPassportLoginUrl
} = require("./jdLoginPageClassifier");

const jdExpiredSessionLoginSelectors = [
  ".el-message-box__btns .el-button--primary:has-text('现在登录')",
  ".el-message-box__btns .el-button--primary:has-text('现在去登录')",
  "[role='dialog'] button:has-text('现在登录')",
  "[role='dialog'] button:has-text('现在去登录')",
  "[aria-modal='true'] button:has-text('现在登录')",
  "[aria-modal='true'] button:has-text('现在去登录')",
  ".el-message-box button:has-text('现在登录')",
  ".el-message-box button:has-text('现在去登录')"
];

async function readSurfaceBodyText(surface) {
  // 该函数只读取当前操作面的正文文本。
  const body = surface.locator("body").first();
  if ((await body.count()) === 0) {
    return "";
  }
  return String(await body.innerText()).replace(/\s+/g, " ").trim();
}

async function attemptDismissJdPopup(surface) {
  // 登录页/安全验证（含滑块）必须留给人工作业：
  // 这类“弹层”没有唯一关闭入口，若交给弹窗引擎会直接抛错并误报为遮挡弹窗，
  // 导致登录等待流程被提前中断。这里明确跳过，让上层继续轮询等待人工登录。
  if (await isJdLoginOrVerificationSurface(surface)) {
    return false;
  }
  // 该函数只关闭当前京东操作面中唯一明确的关闭入口。
  return (await dismissBlockingPopups(surface, { platformName: "京东" })) > 0;
}

async function isJdLoginOrVerificationSurface(surface) {
  // 该函数只判断当前操作面是否属于京东登录页或安全验证面，不做任何点击。
  try {
    const surfaceUrl = typeof surface?.url === "function" ? String(surface.url() || "") : "";
    if (surfaceUrl && isJdPassportLoginUrl(surfaceUrl)) {
      return true;
    }
    const bodyText = await readSurfaceBodyText(surface);
    return hasJdLoginOrVerificationText(bodyText) && !hasJdSystemReadySurfaceText(bodyText);
  } catch (_error) {
    return false;
  }
}

function hasJdSystemReadySurfaceText(bodyText) {
  // 该函数只兜住“业务面同时残留登录字样”的误判：业务面出现查询+导出时按业务页处理。
  const normalizedText = String(bodyText || "");
  return normalizedText.includes("客服工作台") ||
    (normalizedText.includes("查询") && /导出/.test(normalizedText));
}

function isJdBusinessPage(page) {
  // 该函数只限制弹窗处理在当前京东业务域名内。
  return /^https?:\/\/(?:[^/]+\.)?jd\.com/i.test(String(page.url?.() || ""));
}

async function stabilizeJdBrowser(browser) {
  // 该函数只检查当前京东业务页及其 frame，不扫描或操作其他平台页面。
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!isJdBusinessPage(page)) {
        continue;
      }
      for (const surface of page.frames()) {
        await attemptDismissJdPopup(surface);
      }
    }
  }
}

async function hasVisibleJdExpiredSessionDialog(surface) {
  // 该函数只判断登录过期弹窗是否可见，不点击登录按钮。
  for (const selector of jdExpiredSessionLoginSelectors) {
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
  return searchCount > 0 && exportCount > 0 && dateEditorCount > 0;
}

module.exports = {
  attemptDismissJdPopup,
  isJdLoginOrVerificationSurface,
  stabilizeJdBrowser,
  readSurfaceBodyText,
  isJdReportSurfaceReady
};
