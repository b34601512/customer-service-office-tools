const test = require('node:test');
const assert = require('node:assert/strict');
const { 读取当前抖音店铺身份 } = require('../src/browser/douyinStoreIdentity');

function 创建列表(items) {
  return {
    count: async () => items.length,
    nth: (index) => items[index],
  };
}

function 创建店铺身份页面({ initialIds = [], revealedIds = [] } = {}) {
  let ids = [...initialIds];
  let headerClicks = 0;
  const header = {
    waitFor: async () => {},
    click: async () => {
      headerClicks += 1;
      ids = [...revealedIds];
    },
    locator: (selector) => {
      if (selector === ':scope > [data-bytereplay-mask="true"]') {
        return 创建列表([{
          isVisible: async () => true,
          innerText: async () => '目标旗舰店',
        }]);
      }
      if (selector === ':scope [label="店铺ID"][value]') {
        return 创建列表(ids.map((value) => ({ getAttribute: async () => value })));
      }
      throw new Error(`未预期的店铺控件选择器：${selector}`);
    },
  };
  const page = {
    locator: (selector) => {
      if (selector === '.headerShopName') return { first: () => header };
      if (selector === 'button:has-text("我知道了")') {
        return { first: () => ({ click: async () => {} }) };
      }
      throw new Error(`未预期的页面选择器：${selector}`);
    },
    waitForTimeout: async () => {},
  };
  return { page, 读取店名点击次数: () => headerClicks };
}

test('当前店铺身份直接读取结构化店铺ID，不依赖切店入口', async () => {
  const fixture = 创建店铺身份页面({ initialIds: ['29502951'] });

  const identity = await 读取当前抖音店铺身份(fixture.page);

  assert.deepEqual(identity, { storeId: '29502951', storeName: '目标旗舰店' });
  assert.equal(fixture.读取店名点击次数(), 0);
});

test('店铺ID尚未挂载时只打开店铺信息一次再读取', async () => {
  const fixture = 创建店铺身份页面({ revealedIds: ['29502951'] });

  const identity = await 读取当前抖音店铺身份(fixture.page);

  assert.deepEqual(identity, { storeId: '29502951', storeName: '目标旗舰店' });
  assert.equal(fixture.读取店名点击次数(), 1);
});
