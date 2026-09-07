const test = require('node:test');
const assert = require('node:assert/strict');
const {
  计算账号资料目录标识,
  获取账号浏览器资料目录,
} = require('../src/browser/accountProfilePaths');

test('账号资料目录使用哈希避免明文账号入路径', () => {
  const key = 计算账号资料目录标识('user@example.com');
  assert.match(key, /^account-[a-f0-9]{12}$/);
  assert.equal(key.includes('user'), false);
});

test('同手机号两店共用资料，不同手机号隔离', () => {
  const first = 获取账号浏览器资料目录({ id: 'store-a', phoneNumber: '13800138000' });
  const second = 获取账号浏览器资料目录({ id: 'store-b', phoneNumber: ' 13800138000 ' });
  const third = 获取账号浏览器资料目录({ id: 'store-a', phoneNumber: '13900139000' });
  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.equal(first.includes('store-a'), false);
});

test('缺手机号不创建匿名共享登录资料', () => {
  assert.throws(() => 获取账号浏览器资料目录({ id: 'store-a' }), /配置登录手机号/);
});
