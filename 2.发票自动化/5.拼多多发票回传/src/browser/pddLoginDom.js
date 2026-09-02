const 登录输入框选择器列表 = [
  'input#usernameId',
  'input[placeholder="请输入账号名/手机号"]',
];

const 密码输入框选择器列表 = [
  'input#passwordId',
  'input[type="password"]',
  'input[placeholder="请输入密码"]',
];

async function 查找第一个可见输入框(page, selectors = []) {
  // 解决：拼多多登录页可能改 class，但稳定的 id/placeholder 会优先命中。
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function 填写拼多多输入框(locator, value) {
  // 解决：只在配置有值时填充，避免空密码覆盖浏览器已保存内容。
  const text = String(value || '');
  if (!locator || !text) return false;
  await locator.fill(text);
  return true;
}

async function 准备拼多多账号密码登录(page, 店铺配置 = {}) {
  // 解决：打开扫码页后先切换到已采集的账号登录页，再填充账号密码并提交。
  let usernameInput = await 查找第一个可见输入框(page, 登录输入框选择器列表);
  let passwordInput = await 查找第一个可见输入框(page, 密码输入框选择器列表);
  if (!usernameInput || !passwordInput) {
    const 账号登录入口 = page.getByText('账号登录', { exact: true });
    const 账号登录入口数量 = await 账号登录入口.count();
    if (账号登录入口数量 !== 1) {
      return { filled: false, message: '未发现唯一的拼多多“账号登录”入口，无法自动切换登录方式。' };
    }
    await 账号登录入口.click();
    usernameInput = await 查找第一个可见输入框(page, 登录输入框选择器列表);
    passwordInput = await 查找第一个可见输入框(page, 密码输入框选择器列表);
  }
  if (!usernameInput && !passwordInput) {
    return { filled: false, message: '未发现拼多多账号密码登录表单，可能需要扫码或已经登录。' };
  }
  const filledUsername = await 填写拼多多输入框(usernameInput, 店铺配置.username);
  const filledPassword = await 填写拼多多输入框(passwordInput, 店铺配置.password);
  if (filledUsername || filledPassword) {
    const 登录按钮 = page.getByRole('button', { name: '登录', exact: true });
    const 登录按钮数量 = await 登录按钮.count();
    if (登录按钮数量 !== 1) {
      return { filled: true, message: `已填入拼多多店铺「${店铺配置.name || 店铺配置.id}」账号密码，但未发现唯一的登录按钮。` };
    }
    await 登录按钮.click();
    return { filled: true, submitted: true, message: `已填入并点击拼多多店铺「${店铺配置.name || 店铺配置.id}」登录按钮，请等待登录结果。` };
  }
  return { filled: false, message: `拼多多店铺「${店铺配置.name || 店铺配置.id}」未配置账号密码，请人工登录。` };
}

module.exports = {
  查找第一个可见输入框,
  填写拼多多输入框,
  准备拼多多账号密码登录,
};
