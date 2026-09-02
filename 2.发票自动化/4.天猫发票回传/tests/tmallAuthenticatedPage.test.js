const test = require('node:test');
const assert = require('node:assert/strict');
const {
  是天猫业务页面,
  是天猫登录页面,
  是天猫已登录地址,
} = require('../src/browser/tmallAuthenticatedPage');

test('天猫业务页面按 myseller 业务地址判断', () => {
  assert.equal(是天猫业务页面('https://myseller.taobao.com/home.htm/QnworkbenchHome/'), true);
  assert.equal(是天猫业务页面('https://loginmyseller.taobao.com/?redirect_url=https%3A%2F%2Fmyseller.taobao.com%2Fhome.htm'), false);
  assert.equal(是天猫业务页面('https://myseller.taobao.com/error.htm'), false);
});

test('已登录地址识别 myseller 域名（含错误页/中转页）', () => {
  assert.equal(是天猫已登录地址('https://myseller.taobao.com/home.htm/QnworkbenchHome/'), true);
  assert.equal(是天猫已登录地址('https://myseller.taobao.com/error.htm'), true);
  assert.equal(是天猫已登录地址('https://loginmyseller.taobao.com/?from=taobaoindex'), false);
  assert.equal(是天猫已登录地址('https://havanalogin.taobao.com/mini_login.htm'), false);
});

test('天猫登录页面识别 loginmyseller 和 havanalogin', () => {
  assert.equal(是天猫登录页面('https://loginmyseller.taobao.com/?from=taobaoindex'), true);
  assert.equal(是天猫登录页面('https://havanalogin.taobao.com/mini_login.htm'), true);
});
