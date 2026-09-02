const { dismissBlockingPopups } = require("../../shared/blockingPopupEngine");
const { getJdDateRangeEditors, getJdExportButton, getJdSearchButton } = require("./jdControls");
const { hasJdSessionExpiredText } = require("./jdLoginPageClassifier");

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
  // 该函数只关闭当前京东操作面中唯一明确的关闭入口。
  return (await dismissBlockingPopups(surface, { platformName: "京东" })) > 0;
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
  stabilizeJdBrowser,
  readSurfaceBodyText,
  isJdReportSurfaceReady
};
