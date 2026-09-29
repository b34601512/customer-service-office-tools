// 17号建卡工具的单测：只测纯函数（不连后台）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { 构造建卡载荷, 从参数拼装 } = require('../探域建卡.cjs');

const DK = '2104457457798483968';
const DD = '2095398963959042048';

test('SHOP 卡：段落自动补 index（从 1 开始）、只绑给定店铺', () => {
  const p = 构造建卡载荷({ title: 'DEDAKJ 赠品', content: ['第一段', '第二段'], thirdShopIds: [DK] });
  assert.equal(p.type, 'SHOP');
  assert.deepEqual(p.content.map(x => x.index), [1, 2]);
  assert.deepEqual(p.includeCondition.shop, [{ thirdShopId: DK, cids: [] }]);
  assert.equal(p.includeCondition.spu.length, 0);
  assert.deepEqual(p.excludeCondition.shop, []);
  assert.equal(p.version, 'V2');
  assert.equal(p.ifOpen, true);
  assert.equal(p.ifBelievable, true);
});

test('多店铺 / 空行分段：按空行切段，全去空白', () => {
  const p = 构造建卡载荷({ title: 'T', content: '甲\n\n\n乙\n丙', thirdShopIds: [DD, DK] });
  assert.deepEqual(p.content.map(x => x.content), ['甲', '乙\n丙']);
  assert.deepEqual(p.includeCondition.shop.map(s => s.thirdShopId), [DD, DK]);
});

test('反向断言：标题/正文/店铺缺一不可，不许静默兜底', () => {
  assert.throws(() => 构造建卡载荷({ title: '  ', content: ['x'], thirdShopIds: [DK] }), /title/);
  assert.throws(() => 构造建卡载荷({ title: 'x', content: [], thirdShopIds: [DK] }), /content/);
  assert.throws(() => 构造建卡载荷({ title: 'x', content: ['y'], thirdShopIds: [] }), /thirdShopIds/);
});

test('--build 拼装：标题|店铺|正文 三段式；空正文必须报错（反向断言）', () => {
  const p = 从参数拼装({ build: `标题A|${DK},${DD}|正文甲` });
  assert.equal(p.title, '标题A');
  assert.deepEqual(p.includeCondition.shop.map(s => s.thirdShopId), [DK, DD]);
  assert.equal(p.content[0].content, '正文甲');
  assert.throws(() => 从参数拼装({ build: `标题A|${DK}|` }), /content/);
});
