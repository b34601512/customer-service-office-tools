const test = require('node:test');
const assert = require('node:assert/strict');
const {
  是拼多多业务页面,
  是拼多多登录页面,
} = require('../src/browser/pddAuthenticatedPage');
const {
  读取拼多多登录跳转地址,
  是同源拼多多业务页面,
  是拼多多目标或登录页面,
} = require('../src/browser/pddBrowserContext');

test('拼多多业务页和登录页按 URL 区分', () => {
  assert.equal(是拼多多业务页面('https://mms.pinduoduo.com/home/'), true);
  assert.equal(是拼多多业务页面('https://mms.pinduoduo.com/login/?redirectUrl=x'), false);
  assert.equal(是拼多多登录页面('https://mms.pinduoduo.com/login/?redirectUrl=x'), true);
  assert.equal(是拼多多登录页面('https://mms.pinduoduo.com/invoice/center'), false);
});

test('持久化浏览器复用登录跳转后的同源业务页', () => {
  const loginUrl = 'https://mms.pinduoduo.com/login/?redirectUrl=https%3A%2F%2Fmms.pinduoduo.com%2F';

  assert.equal(读取拼多多登录跳转地址(loginUrl), 'https://mms.pinduoduo.com/');
  assert.equal(是同源拼多多业务页面('https://mms.pinduoduo.com/invoice/center', loginUrl), true);
  assert.equal(是拼多多目标或登录页面('https://mms.pinduoduo.com/invoice/center', loginUrl), true);
  assert.equal(是拼多多目标或登录页面('https://example.com/', loginUrl), false);
});
