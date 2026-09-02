const JD_PASSWORD_LOGIN_SUBMIT_SELECTOR = "#loginsubmit[_submit='true']";

const JD_EXPIRED_SESSION_LOGIN_BUTTON_SELECTORS = [
  ".el-message-box__btns .el-button--primary:has-text('现在登录')",
  ".el-message-box__btns .el-button--primary:has-text('现在去登录')",
  "[role='dialog'] button:has-text('现在登录')",
  "[role='dialog'] button:has-text('现在去登录')",
  "[aria-modal='true'] button:has-text('现在登录')",
  "[aria-modal='true'] button:has-text('现在去登录')",
  ".ant-modal button:has-text('现在登录')",
  ".ant-modal button:has-text('现在去登录')",
  ".el-message-box button:has-text('现在登录')",
  ".el-message-box button:has-text('现在去登录')",
  "[role='dialog'] [role='button']:has-text('现在登录')",
  "[role='dialog'] [role='button']:has-text('现在去登录')",
  "button:has-text('现在登录')",
  "button:has-text('现在去登录')",
  "button:has-text('去登录')",
  "a:has-text('现在登录')",
  "a:has-text('现在去登录')",
  "a:has-text('去登录')",
  "[role='button']:has-text('现在登录')",
  "[role='button']:has-text('现在去登录')",
  "[role='button']:has-text('去登录')"
];

function resolveJdLoginSurfacePage(surface) {
  // 这个函数只把 page 或 frame 统一解析成所属页面。
  return typeof surface?.page === "function" ? surface.page() : surface;
}

async function findFirstVisibleJdLoginLocator(surface, selectors) {
  // 这个函数只按既有顺序返回第一个可见京东登录元素。
  for (const selector of selectors) {
    const locator = surface.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      return locator;
    }
  }
  return null;
}

async function findJdExpiredSessionLoginButton(surface) {
  // 这个函数只定位登录过期弹窗中的既有登录按钮。
  return findFirstVisibleJdLoginLocator(surface, JD_EXPIRED_SESSION_LOGIN_BUTTON_SELECTORS);
}

async function findJdPasswordLoginSubmitButton(surface) {
  // 这个函数只按京东官方唯一身份定位密码登录提交按钮。
  return findFirstVisibleJdLoginLocator(surface, [JD_PASSWORD_LOGIN_SUBMIT_SELECTOR]);
}

module.exports = {
  JD_EXPIRED_SESSION_LOGIN_BUTTON_SELECTORS,
  resolveJdLoginSurfacePage,
  findFirstVisibleJdLoginLocator,
  findJdExpiredSessionLoginButton,
  findJdPasswordLoginSubmitButton
};
