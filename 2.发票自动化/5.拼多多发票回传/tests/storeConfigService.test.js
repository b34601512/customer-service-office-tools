const test = require('node:test');
const assert = require('node:assert/strict');
const {
  规范化店铺配置,
  校验店铺配置列表,
  拼多多默认登录地址,
} = require('../src/store/storeConfigService');

test('规范化店铺配置会补齐默认登录地址和启用状态', () => {
  const 店铺 = 规范化店铺配置({ name: '旗舰店', username: ' user ', password: 'pwd' });
  assert.equal(店铺.id, '旗舰店');
  assert.equal(店铺.targetUrl, 拼多多默认登录地址);
  assert.equal(店铺.username, 'user');
  assert.equal(店铺.password, 'pwd');
  assert.equal(店铺.enabled, true);
});

test('重复店铺标识会直接报错', () => {
  assert.throws(() => 校验店铺配置列表([
    { id: 'same', name: '店铺A' },
    { id: 'same', name: '店铺B' },
  ]), /店铺标识重复/);
});
