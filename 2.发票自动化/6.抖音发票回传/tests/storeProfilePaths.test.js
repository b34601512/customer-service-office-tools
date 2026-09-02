const test = require('node:test');
const assert = require('node:assert/strict');
const {
  计算账号资料目录标识,
  获取店铺账号浏览器资料目录,
} = require('../src/browser/storeProfilePaths');

test('账号资料目录使用哈希避免明文账号入路径', () => {
  const key = 计算账号资料目录标识('user@example.com');
  assert.match(key, /^account-[a-f0-9]{12}$/);
  assert.equal(key.includes('user'), false);
});

test('不同店铺和不同账号的浏览器资料目录物理隔离', () => {
  const first = 获取店铺账号浏览器资料目录({ storeId: 'store-a', username: 'a@example.com' });
  const second = 获取店铺账号浏览器资料目录({ storeId: 'store-b', username: 'a@example.com' });
  const third = 获取店铺账号浏览器资料目录({ storeId: 'store-a', username: 'b@example.com' });
  assert.notEqual(first, second);
  assert.notEqual(first, third);
});
