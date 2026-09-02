const { 打印日志 } = require('../common/logger');
const { 等待直到 } = require('./dynamicWait');

const 京东登录表单选择器 = Object.freeze({
  账号输入框: '#loginname',
  密码输入框: 'input[type="password"]',
  登录按钮: 'button.password__submit',
});

function 读取店铺登录凭据(店铺配置) {
  // 解决：登录凭据只在一个入口校验，缺少哪一项就直接说明哪一项。
  const 店铺名称 = String(店铺配置?.name || 店铺配置?.id || '当前店铺').trim();
  const 账号 = String(店铺配置?.username || '').trim();
  const 密码 = String(店铺配置?.password || '');
  if (!账号) {
    throw new Error(`「${店铺名称}」未配置京东登录账号。`);
  }
  if (!密码) {
    throw new Error(`「${店铺名称}」未配置京东登录密码。`);
  }
  return { 店铺名称, 账号, 密码 };
}

async function 获取唯一可见元素(page, 选择器) {
  // 解决：真实登录表单中的账号、密码和登录按钮都必须唯一且可见。
  const 元素 = page.locator(选择器);
  if (await 元素.count() !== 1) return null;
  return await 元素.isVisible().catch(() => false) ? 元素 : null;
}

async function 等待京东登录表单(page) {
  // 解决：按真实采集的完整登录表单状态继续，不猜固定等待时间。
  return 等待直到(page, async () => {
    const 账号输入框 = await 获取唯一可见元素(page, 京东登录表单选择器.账号输入框);
    const 密码输入框 = await 获取唯一可见元素(page, 京东登录表单选择器.密码输入框);
    const 登录按钮 = await 获取唯一可见元素(page, 京东登录表单选择器.登录按钮);
    const 登录按钮可用 = 登录按钮
      ? await 登录按钮.isEnabled().catch(() => false)
      : false;
    return 账号输入框 && 密码输入框 && 登录按钮可用
      ? { 账号输入框, 密码输入框, 登录按钮 }
      : null;
  }, {
    timeoutMs: 20_000,
    intervalMs: 200,
    超时消息: '京东登录页已打开，但真实账号、密码或立即登录按钮没有准备好。',
  });
}

async function 提交京东登录表单(page, 店铺配置) {
  // 解决：登录页只走真实表单的一条链，填好配置后点击同一个“立即登录”按钮。
  const { 店铺名称, 账号, 密码 } = 读取店铺登录凭据(店铺配置);
  const { 账号输入框, 密码输入框, 登录按钮 } = await 等待京东登录表单(page);
  await 账号输入框.fill(账号);
  await 密码输入框.fill(密码);
  await page.bringToFront().catch(() => {});
  await 登录按钮.click();
  打印日志('登录流程', '京东登录表单', `已自动填入账号密码并点击立即登录：${店铺名称}；如出现滑块/验证码，请人工完成`);
}

module.exports = {
  京东登录表单选择器,
  读取店铺登录凭据,
  提交京东登录表单,
};
