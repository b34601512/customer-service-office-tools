const test = require('node:test');
const assert = require('node:assert/strict');
const {
  是抖音业务页面,
  是抖音登录页面,
  是抖音官网首页,
} = require('../src/browser/douyinAuthenticatedPage');
const {
  读取抖音登录跳转地址,
  是同源抖音业务页面,
  是抖音目标或登录页面,
} = require('../src/browser/douyinBrowserContext');

test('抖音业务页和登录页按 URL 区分', () => {
  assert.equal(是抖音业务页面('https://fxg.jinritemai.com/ffa/mshop/homepage/index'), true);
  assert.equal(是抖音官网首页('https://fxg.jinritemai.com/'), true);
  assert.equal(是抖音业务页面('https://fxg.jinritemai.com/login/common?redirectUrl=x'), false);
  assert.equal(是抖音登录页面('https://fxg.jinritemai.com/login/common?redirectUrl=x'), true);
  assert.equal(是抖音登录页面('https://fxg.jinritemai.com/ffa/morder/receipt/list'), false);
});

test('持久化浏览器复用登录跳转后的同源业务页', () => {
  const loginUrl = 'https://fxg.jinritemai.com/';

  assert.equal(读取抖音登录跳转地址(loginUrl), '');
  assert.equal(是同源抖音业务页面('https://fxg.jinritemai.com/ffa/morder/receipt/list', loginUrl), true);
  assert.equal(是抖音目标或登录页面('https://fxg.jinritemai.com/ffa/morder/receipt/list', loginUrl), true);
  assert.equal(是抖音目标或登录页面('https://example.com/', loginUrl), false);
});
