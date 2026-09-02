const test = require('node:test');
const assert = require('node:assert/strict');

const { 应该关闭巡检浏览器 } = require('../src/app/browserRetentionPolicy');

test('只有成功完成的 keep 页面才允许保留', () => {
  assert.equal(应该关闭巡检浏览器('keep', true), false);
  assert.equal(应该关闭巡检浏览器('keep', false), true);
  assert.equal(应该关闭巡检浏览器('wait', true), true);
  assert.equal(应该关闭巡检浏览器('close', true), true);
});
