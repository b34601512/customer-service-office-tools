const test = require('node:test');
const assert = require('node:assert/strict');
const { 读取当前抖音店铺身份, 确保抖音目标店铺, 点击切店入口 } = require('../src/browser/douyinStoreIdentity');

test('缺少平台店铺ID时阻止处理，不跳过身份核验', async () => {
  await assert.rejects(确保抖音目标店铺({}, { id: 'a', name: 'A店' }), /尚未配置平台店铺ID/);
});

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
      if (selector === ':scope [class*="userName"][data-bytereplay-mask="true"]') {
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
      if (selector === '[class*="headerShopName"]') return { first: () => header };
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

function 创建切店入口页面({ 初始可见 = true, 每次点击都失败 = false, 首次点击落入失效 = false } = {}) {
  let 可见 = 初始可见;
  let 入口点击次数 = 0;
  let 店名点击次数 = 0;
  const entry = {
    isVisible: async () => 可见,
    click: async () => {
      入口点击次数 += 1;
      if (每次点击都失败) {
        可见 = false;
        throw new Error("locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByText('切换组织/店铺', { exact: true }).first()\n    - element is not visible");
      }
      if (首次点击落入失效 && 入口点击次数 === 1) {
        // 复现现场：扫描时入口可见，点击时弹层已收起 → element is not visible。
        可见 = false;
        throw new Error("locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByText('切换组织/店铺', { exact: true }).first()\n    - element is not stable\n    - element is not visible");
      }
      可见 = true;
    },
  };
  const entries = { count: async () => 1, nth: () => entry };
  const header = {
    waitFor: async () => {},
    click: async () => {
      店名点击次数 += 1;
      可见 = true;
    },
  };
  const page = {
    getByText: () => entries,
    locator: (selector) => {
      if (selector === '[class*="headerShopName"]') return { first: () => header };
      throw new Error(`未预期的页面选择器：${selector}`);
    },
    waitForTimeout: async () => {},
  };
  return { page, 入口点击次数: () => 入口点击次数, 店名点击次数: () => 店名点击次数 };
}

test('切店入口首次点击落入失效元素时必须重开菜单重试，而不是一次失败就放弃', async () => {
  const fixture = 创建切店入口页面({ 首次点击落入失效: true });

  await 点击切店入口(fixture.page);

  assert.equal(fixture.入口点击次数(), 2, '首次点击失效后应重新解析入口并再次点击');
  assert.equal(fixture.店名点击次数(), 1, '入口不可见时应重新点开店铺菜单');
});

test('店铺菜单未打开时先点开菜单再点击入口', async () => {
  const fixture = 创建切店入口页面({ 初始可见: false });

  await 点击切店入口(fixture.page);

  assert.equal(fixture.入口点击次数(), 1);
  assert.equal(fixture.店名点击次数(), 1);
});

test('切店入口持续不可点时按上限重试后报错，不无限重试', async () => {
  const fixture = 创建切店入口页面({ 每次点击都失败: true });

  await assert.rejects(点击切店入口(fixture.page, { 最大尝试次数: 3 }), /locator\.click: Timeout 5000ms exceeded/);

  assert.equal(fixture.入口点击次数(), 3);
});

// ===== 2026-09-30 失败台账规律 #1（切店卡死 5 次）：诊断信息不许再被静默吞掉 =====
const { 等待目标店铺 } = require('../src/browser/douyinStoreIdentity');

function 创建等待目标店铺页面({ 身份读取错误 = '', 当前店铺 = { storeId: '111111', storeName: '德达医疗康养器械旗舰店' } } = {}) {
  const header = {
    count: async () => 1,
    isVisible: async () => true,
    waitFor: async () => {},
    click: async () => {},
    evaluate: async () => { throw new Error('测试不采集现场'); },
    locator: (selector) => {
      if (selector === ':scope [class*="userName"][data-bytereplay-mask="true"]') {
        if (身份读取错误) return 创建列表([]);
        return 创建列表([{ isVisible: async () => true, innerText: async () => 当前店铺.storeName }]);
      }
      if (selector === ':scope [label="店铺ID"][value]') {
        return 创建列表([{ getAttribute: async () => 当前店铺.storeId }]);
      }
      throw new Error(`未预期的店铺控件选择器：${selector}`);
    },
  };
  const page = {
    url: () => 'https://fxg.jinritemai.com/ffa/mshop/homepage/index',
    locator: (selector) => {
      if (selector === '[class*="headerShopName"]') return { first: () => header };
      if (selector === 'button:has-text("我知道了")') return { first: () => ({ click: async () => {} }) };
      throw new Error(`未预期的页面选择器：${selector}`);
    },
    context: () => ({ pages: () => [page] }),
    waitForTimeout: async () => {},
  };
  return page;
}

test('等待目标店铺超时时必须带上最近读取错误，不再静默吞错', async () => {
  const 页面 = 创建等待目标店铺页面({ 身份读取错误: true });

  await assert.rejects(
    () => 等待目标店铺(页面, { storeId: '29502951', storeName: 'DEDAKJ医疗器械旗舰店' }, 300),
    (错误) => /目标=DEDAKJ医疗器械旗舰店\(29502951\)/.test(错误.message)
      && /最近读取错误=读取抖音当前店铺名称失败/.test(错误.message)
  );
});

test('身份一致时立即返回，不进入轮询等待', async () => {
  const 页面 = 创建等待目标店铺页面({ 当前店铺: { storeId: '29502951', storeName: 'DEDAKJ医疗器械旗舰店' } });

  const 结果 = await 等待目标店铺(页面, { storeId: '29502951', storeName: 'DEDAKJ医疗器械旗舰店' }, 30_000);

  assert.deepEqual(结果.identity, { storeId: '29502951', storeName: 'DEDAKJ医疗器械旗舰店' });
});

test('切店失败时报错必须带各阶段耗时，能看出卡在哪一段', async () => {
  const 页面 = 创建等待目标店铺页面({ 当前店铺: { storeId: '162329841', storeName: '德达医疗康养器械旗舰店' } });
  const 入口 = { isVisible: async () => true, click: async () => { throw new Error('locator.click: Timeout 5000ms exceeded.'); } };
  页面.getByText = () => ({ count: async () => 1, nth: () => 入口 });

  await assert.rejects(
    () => 确保抖音目标店铺(页面, { id: 'douyin-store-2', name: '抖音店铺5 DEDAKJ医疗器械旗舰店', platformStoreId: '29502951', platformStoreName: 'DEDAKJ医疗器械旗舰店' }, null, { storeSwitchTimeoutMs: 500 }),
    (错误) => /切店阶段：读取当前身份=\d+ms/.test(错误.message) && /点击切店入口=失败\(\d+ms\)/.test(错误.message)
  );
});
