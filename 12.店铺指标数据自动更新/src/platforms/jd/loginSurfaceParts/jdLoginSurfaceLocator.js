// 京麦登录页仍保留 loginsubmit 作为稳定身份；_submit 属性属于动态状态，不能作为身份选择器。
const JD_PASSWORD_LOGIN_SUBMIT_SELECTORS = [
  "#loginsubmit",
  "button:text-is('立即登录')",
  "[role='button']:text-is('立即登录')",
  "a:text-is('立即登录')",
  "input[type='submit']"
];

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
  // 这里按选择器优先级挑第一个可见京东登录元素，忽略同一选择器下的隐藏副本。
  for (const selector of selectors) {
    const locator = surface.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) {
        return candidate;
      }
    }
  }
  return null;
}

async function findUniqueVisibleJdLoginLocator(surface, selectors) {
  // 这里只返回“唯一可见”的候选，避免页面改版后误点相似按钮。
  for (const selector of selectors) {
    const locator = surface.locator(selector);
    const count = await locator.count();
    let visibleCount = 0;
    let visibleLocator = null;
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible())) {
        continue;
      }
      visibleCount += 1;
      visibleLocator = candidate;
      if (visibleCount > 1) {
        break;
      }
    }
    if (visibleCount === 1) {
      return visibleLocator;
    }
  }
  return null;
}

async function findJdExpiredSessionLoginButton(surface) {
  // 这个函数只定位登录过期弹窗中的既有登录按钮。
  return findFirstVisibleJdLoginLocator(surface, JD_EXPIRED_SESSION_LOGIN_BUTTON_SELECTORS);
}

async function findJdPasswordLoginSubmitButton(surface) {
  // 先认稳定 ID 和语义按钮；新版京麦把按钮渲染成普通文本节点，最后按唯一可见完整文案定位。
  const selectorLocator = await findUniqueVisibleJdLoginLocator(surface, JD_PASSWORD_LOGIN_SUBMIT_SELECTORS);
  if (selectorLocator) return selectorLocator;
  if (typeof surface?.getByText !== "function") return null;

  const textLocator = surface.getByText("立即登录", { exact: true });
  const visibleTextLocators = [];
  for (let index = 0; index < await textLocator.count(); index += 1) {
    const candidate = textLocator.nth(index);
    if (await candidate.isVisible() && !await candidate.isDisabled().catch(() => false)) {
      visibleTextLocators.push(candidate);
    }
  }
  return visibleTextLocators.length === 1 ? visibleTextLocators[0] : null;
}

module.exports = {
  JD_EXPIRED_SESSION_LOGIN_BUTTON_SELECTORS,
  resolveJdLoginSurfacePage,
  findFirstVisibleJdLoginLocator,
  findUniqueVisibleJdLoginLocator,
  findJdExpiredSessionLoginButton,
  findJdPasswordLoginSubmitButton
};
