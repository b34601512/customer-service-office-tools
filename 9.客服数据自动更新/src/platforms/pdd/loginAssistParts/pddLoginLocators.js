// 该文件用于解决拼多多账号登录切换、可见控件定位和账号密码填充问题。
const { clickLocatorWhenReady } = require("../../../shared/browserActionEngine");

async function findFirstVisibleLocator(frame, selectors) {
  // 这里统一挑第一个可见输入框，避免隐藏字段或扫码区字段被误填。
  for (const selector of selectors) {
    const locatorGroup = frame.locator(selector);
    const count = await locatorGroup.count();
    for (let index = 0; index < count; index += 1) {
      const locator = typeof locatorGroup.nth === "function" ? locatorGroup.nth(index) : locatorGroup.first();
      if (await isLocatorVisible(locator)) {
        return locator;
      }
    }
  }

  return null;
}

async function isLocatorVisible(locator) {
  // 这里只判断控件是否真实可见，候选扫描和输入框扫描都复用同一口径。
  return Boolean(locator && (await locator.count()) > 0 && (await locator.isVisible()));
}

function buildAccountLoginLocatorCandidates(frame, text) {
  // 这里集中生成账号登录候选，避免某一种 Playwright 定位方式失效后整条链路卡住。
  const candidates = [];
  if (typeof frame.getByRole === "function") {
    candidates.push(frame.getByRole("tab", { name: text, exact: true }));
    candidates.push(frame.getByRole("button", { name: text, exact: true }));
  }
  if (typeof frame.getByText === "function") {
    candidates.push(frame.getByText(text, { exact: true }));
    candidates.push(frame.getByText(text, { exact: false }));
  }
  if (typeof frame.locator === "function") {
    candidates.push(frame.locator(`button:has-text("${text}")`));
    candidates.push(frame.locator(`a:has-text("${text}")`));
    candidates.push(frame.locator(`span:has-text("${text}")`));
    candidates.push(frame.locator(`div:has-text("${text}")`));
  }

  return candidates;
}

async function clickFirstVisibleTextCandidate(frame, text) {
  // 这里逐个扫描可见候选并确认点击成功，不能再因为隐藏的第一个文本节点而放弃。
  for (const locatorGroup of buildAccountLoginLocatorCandidates(frame, text)) {
    const count = await locatorGroup.count();
    for (let index = 0; index < count; index += 1) {
      const locator = typeof locatorGroup.nth === "function" ? locatorGroup.nth(index) : locatorGroup.first();
      if (!(await isLocatorVisible(locator))) {
        continue;
      }

      await clickLocatorWhenReady(locator, `拼多多登录方式切换${text}`, { timeoutMs: 3000 });
      return true;
    }
  }

  return false;
}

async function waitForPddAccountInputs(frame) {
  // 这里等待账号密码输入框出现，避免点击账号登录后页面还没切完就立刻判断失败。
  await frame.waitForFunction(
      () => {
        const inputs = Array.from(document.querySelectorAll("input"));
        return inputs.some((element) => {
          const style = window.getComputedStyle(element);
          const visible =
            style &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            element.getClientRects().length > 0;
          if (!visible) {
            return false;
          }

          const text = [
            element.getAttribute("type"),
            element.getAttribute("placeholder"),
            element.getAttribute("name")
          ]
            .filter(Boolean)
            .join(" ");
          return /password|密码|账号|手机号|phone|mobile/i.test(text);
        });
      },
      { timeout: 3000 }
    );
}

async function trySwitchToAccountLogin(frame) {
  // 这里先切到账号登录，拼多多默认扫码页没有账号密码输入框。
  const candidateTexts = ["账号登录", "账户登录", "密码登录"];

  for (const text of candidateTexts) {
    const clicked = await clickFirstVisibleTextCandidate(frame, text);
    if (!clicked) {
      continue;
    }

    try {
      await waitForPddAccountInputs(frame);
      return true;
    } catch {
      // 这里在切换点击后输入框未按时出现时只放弃当前候选文案，继续尝试下一个候选，
      // 不能让单次等待超时把整轮5分钟登录辅助会话直接终止（#604）。
    }
  }

  return false;
}

async function tryAutofillPddLoginFrame(frame, credentials = {}) {
  // 这里把拼多多登录页切到账密模式后填入配置账号，并点击普通登录按钮，验证码和滑块仍交给用户完成。
  const switched = await trySwitchToAccountLogin(frame);
  const usernameLocator = await findFirstVisibleLocator(frame, [
    "input[placeholder*='账号名']",
    "input[placeholder*='手机号']",
    "input[placeholder*='账号']",
    "input[type='tel']",
    "input[type='text']",
    "input[name*='user']",
    "input[name*='phone']",
    "input[name*='mobile']"
  ]);
  const passwordLocator = await findFirstVisibleLocator(frame, [
    "input[type='password']",
    "input[placeholder*='密码']",
    "input[name*='password']"
  ]);

  if (!usernameLocator || !passwordLocator) {
    return {
      switched,
      filled: false
    };
  }

  if (credentials.username) {
    await usernameLocator.fill(credentials.username);
  }

  if (credentials.password) {
    await passwordLocator.fill(credentials.password);
  }

  const submitLocator = await findFirstVisibleLocator(frame, [
    "button[type='submit']",
    "button:has-text('登录')",
    "button:has-text('立即登录')",
    "button:has-text('登录拼多多')",
    "[role='button']:has-text('登录')",
    "[role='button']:has-text('立即登录')"
  ]);
  if (submitLocator) {
    await clickLocatorWhenReady(submitLocator, "拼多多登录按钮", { timeoutMs: 5000 });
  }

  return {
    switched,
    filled: Boolean(credentials.username || credentials.password)
  };
}

module.exports = {
  findFirstVisibleLocator,
  isLocatorVisible,
  buildAccountLoginLocatorCandidates,
  clickFirstVisibleTextCandidate,
  waitForPddAccountInputs,
  trySwitchToAccountLogin,
  tryAutofillPddLoginFrame
};
