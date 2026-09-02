const 手机号输入框选择器列表 = [
  'input[name="mobile"]',
  'input[autocomplete="mobile"]',
  'input[placeholder="手机号码"]',
  'input[placeholder*="手机号"]',
  'input[placeholder*="手机"]',
  'input[type="tel"]',
  'input#mobile',
  'input#usernameId',
];

async function 查找第一个可见输入框(page, selectors = []) {
  // 解决：抖音登录页以手机号为主，优先命中手机号相关输入框。
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function 填写抖音输入框(locator, value) {
  // 解决：只在配置有值时填充，避免空手机号覆盖页面已有内容。
  const text = String(value || '').trim();
  if (!locator || !text) return false;
  await locator.fill(text);
  return true;
}

function 读取抖音登录手机号(店铺配置 = {}) {
  // 解决：配置字段兼容旧 username，但抖音业务语义统一叫手机号。
  return String(
    店铺配置.phoneNumber
    || 店铺配置.mobile
    || 店铺配置.phone
    || 店铺配置.username
    || ''
  ).trim();
}

async function 点击抖音发送验证码(page) {
  // 解决：手机号填好后只触发一次发送验证码，不自动提交登录。
  await page.waitForTimeout(300).catch(() => {});
  return page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const text = (element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],span,div'))
      .filter((element) => visible(element) && text(element) === '发送验证码')
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
      });
    const target = candidates[0];
    if (!target) return { clicked: false, message: '未发现可点击的发送验证码控件。' };
    const disabled = target.disabled === true
      || target.getAttribute('aria-disabled') === 'true'
      || /\bdisabled\b/i.test(String(target.className || ''));
    if (disabled) return { clicked: false, message: '发送验证码控件当前不可用。' };
    target.click();
    return { clicked: true, message: '已点击发送验证码，请查看手机短信。' };
  }).catch((error) => ({ clicked: false, message: `点击发送验证码失败：${error.message}` }));
}

async function 准备抖音手机号登录(page, 店铺配置 = {}, 选项 = {}) {
  // 解决：抖音登录自动填手机号并发送验证码，但不自动点击登录。
  const { autoSendCode = true } = 选项;
  const 手机号输入框 = await 查找第一个可见输入框(page, 手机号输入框选择器列表);
  if (!手机号输入框) {
    return { filled: false, message: '未发现抖音手机号登录输入框，可能需要扫码或已经登录。' };
  }
  const filled = await 填写抖音输入框(手机号输入框, 读取抖音登录手机号(店铺配置));
  if (filled) {
    if (autoSendCode) {
      const sendResult = await 点击抖音发送验证码(page);
      return {
        filled: true,
        sentCode: sendResult.clicked,
        message: `已填入抖音店铺「${店铺配置.name || 店铺配置.id}」手机号。${sendResult.message}`,
      };
    }
    return { filled: true, sentCode: false, message: `已填入抖音店铺「${店铺配置.name || 店铺配置.id}」手机号，请人工完成验证码或扫码登录。` };
  }
  return { filled: false, message: `抖音店铺「${店铺配置.name || 店铺配置.id}」未配置手机号，请人工登录。` };
}

module.exports = {
  手机号输入框选择器列表,
  查找第一个可见输入框,
  填写抖音输入框,
  点击抖音发送验证码,
  读取抖音登录手机号,
  准备抖音手机号登录,
};
