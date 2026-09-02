const test = require('node:test');
const assert = require('node:assert/strict');
const {
  提取候选控件文本,
  读取天猫业务后台地址,
} = require('../src/app/collectTmallElements');

test('采集控件文本会压缩空白并限制长度', () => {
  const text = 提取候选控件文本('  发票\n\t回传  '.repeat(30));
  assert.equal(text.includes('\n'), false);
  assert.ok(text.length <= 120);
});

test('采集业务地址优先使用登录链接里的 redirect_url', () => {
  const address = 读取天猫业务后台地址({
    targetUrl: 'https://loginmyseller.taobao.com/?redirect_url=https%3A%2F%2Fmyseller.taobao.com%2Fhome.htm%2FQnworkbenchHome%2F',
  });
  assert.equal(address, 'https://myseller.taobao.com/home.htm/QnworkbenchHome/');
});

test('采集业务地址会直接保留已配置的业务首页', () => {
  const address = 读取天猫业务后台地址({
    targetUrl: 'https://myseller.taobao.com/home.htm/QnworkbenchHome/',
  });
  assert.equal(address, 'https://myseller.taobao.com/home.htm/QnworkbenchHome/');
});
