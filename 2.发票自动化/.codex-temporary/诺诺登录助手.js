// 人工登录助手：打开诺诺登录页并预填账号密码，等用户在窗口里输入验证码完成登录；
// 登录成功后保存登录态再退出。只做登录，不下载/不上传/不提交。
// 用法：node .codex-temporary/诺诺登录助手.js
const fs = require('fs');
const path = require('path');
const 下载中心 = path.resolve(__dirname, '..', '3.通用发票下载中心');
const { 读取发票系统配置 } = require(path.join(下载中心, 'src/index'));
const { 创建诺诺浏览器会话 } = require(path.join(下载中心, 'src/nuonuo/nuonuoBrowserSession'));
const { 验证诺诺发票会话 } = require(path.join(下载中心, 'src/nuonuo/loginVerifier'));
const { 登录态文件路径 } = require(path.join(下载中心, 'src/common/paths'));

const 配置 = 读取发票系统配置();

async function 等待可见(page, 选择器, timeoutMs) {
  const 截止 = Date.now() + timeoutMs;
  while (Date.now() < 截止) {
    const el = page.locator(选择器).first();
    if (await el.count() && await el.isVisible().catch(() => false)) return el;
    await page.waitForTimeout(500);
  }
  return null;
}

(async () => {
  const session = await 创建诺诺浏览器会话({ headless: false, useSavedAuthState: true });
  const page = session.page;
  await page.goto(配置.targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', e.message));
  let 账号框 = await 等待可见(page, '#usernameInput, input[name="username"]', 30000);
  if (!账号框) {
    // 默认可能是扫码页，切到账号密码登录。
    const 标签 = page.getByText('账号密码登录', { exact: false }).first();
    await 标签.click({ timeout: 5000 }).catch(() => {});
    账号框 = await 等待可见(page, '#usernameInput, input[name="username"]', 15000);
  }
  if (账号框) {
    await 账号框.fill(配置.username).catch(() => {});
    const 密码框 = page.locator('input[type="password"]').first();
    await 密码框.fill(配置.password).catch(() => {});
    console.log('已预填诺诺账号密码，请在浏览器窗口输入验证码并点击“立即登录”。');
  } else {
    console.log('未找到账号密码表单，请在浏览器窗口手动完成登录。');
  }
  console.log('URL=' + page.url());
  const 截止 = Date.now() + 240 * 60 * 1000;
  while (Date.now() < 截止) {
    await page.waitForTimeout(5000);
    const url = page.url();
    if (url.includes('work.nuonuo.com') && !/login|usercenter\/allow\/login/i.test(url)) {
      try {
        const 主体 = await 验证诺诺发票会话(page, { timeoutMs: 30000 });
        await session.context.storageState({ path: 登录态文件路径 });
        console.log('诺诺登录成功并已保存登录态，主体数=' + (主体.companies || []).length);
        await session.browser.close().catch(() => {});
        process.exit(0);
      } catch (e) {
        console.log('页面已进入工作台但真实校验未过：' + e.message);
      }
    }
  }
  console.log('等待人工登录超时（240分钟）。');
  process.exit(2);
})().catch((e) => { console.error('异常：' + (e && e.stack || e)); process.exit(1); });
