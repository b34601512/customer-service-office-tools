const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const {
  准备抖音手机号登录,
  读取抖音登录手机号,
} = require('../src/browser/douyinLoginDom');

test('抖音登录会填写手机号并点击发送验证码但不点击登录', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <input name="mobile" autocomplete="mobile" placeholder="手机号码" />
      <span id="sendCode">发送验证码</span>
      <button id="loginButton">登录</button>
      <script>
        window.sentCode = false;
        window.clickedLogin = false;
        document.querySelector('#sendCode').addEventListener('click', () => { window.sentCode = true; });
        document.querySelector('#loginButton').addEventListener('click', () => { window.clickedLogin = true; });
      </script>
    `);

    const result = await 准备抖音手机号登录(page, {
      id: 'douyin-store-1',
      name: '抖音店铺',
      phoneNumber: '13800000000',
    });
    const state = await page.evaluate(() => ({
      phone: document.querySelector('input[name="mobile"]').value,
      sentCode: window.sentCode,
      clickedLogin: window.clickedLogin,
    }));

    assert.equal(result.filled, true);
    assert.equal(result.sentCode, true);
    assert.equal(state.phone, '13800000000');
    assert.equal(state.sentCode, true);
    assert.equal(state.clickedLogin, false);
  } finally {
    await browser.close();
  }
});

test('抖音登录手机号兼容旧 username 字段', () => {
  assert.equal(读取抖音登录手机号({ username: ' 13800000000 ' }), '13800000000');
});
