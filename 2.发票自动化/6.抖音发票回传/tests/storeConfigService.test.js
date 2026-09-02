const test = require('node:test');
const assert = require('node:assert/strict');
const {
  规范化店铺配置,
  校验店铺配置列表,
  抖音默认登录地址,
} = require('../src/store/storeConfigService');

test('规范化店铺配置会补齐默认登录地址、手机号和启用状态', () => {
  const 店铺 = 规范化店铺配置({ name: '旗舰店', phoneNumber: ' 13800138000 ' });
  assert.equal(店铺.id, '旗舰店');
  assert.equal(店铺.targetUrl, 抖音默认登录地址);
  assert.equal(店铺.phoneNumber, '13800138000');
  assert.equal(店铺.username, '13800138000');
  assert.equal(店铺.password, '');
  assert.equal(店铺.enabled, true);
});

test('重复店铺标识会直接报错', () => {
  assert.throws(() => 校验店铺配置列表([
    { id: 'same', name: '店铺A' },
    { id: 'same', name: '店铺B' },
  ]), /店铺标识重复/);
});
