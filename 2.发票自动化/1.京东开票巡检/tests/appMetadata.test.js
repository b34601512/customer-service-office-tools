const test = require('node:test');
const assert = require('node:assert/strict');

const { 构建应用展示信息 } = require('../src/common/appMetadata');

test('主界面展示信息应该包含作者、微信和官网地址', () => {
  const 展示信息 = 构建应用展示信息({
    显示版本: '0.02',
  });

  assert.deepEqual(展示信息, {
    appName: '京东开票巡检',
    version: '0.02',
    authorName: '黎路遥',
    authorWechat: 'luyao2089',
    officialWebsite: 'luyao2089.cc',
    officialWebsiteUrl: 'https://luyao2089.cc',
  });
});
