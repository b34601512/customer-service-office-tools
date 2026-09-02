const test = require('node:test');
const assert = require('node:assert/strict');
const {
  构建命令行巡检摘要,
  获取最近命令行巡检摘要,
  输出巡检摘要,
} = require('../src/cli/inspectionOverview');
const { 输出巡检结果 } = require('../src/cli/startCli');

function 构建测试终端() {
  const 主题 = {};
  ['小标题', '成功', '失败', '强调', '正文', '弱化', '提醒'].forEach((名称) => {
    主题[名称] = (文字) => 文字;
  });
  return { 主题 };
}

function 构建成功店铺结果(店铺标识, 店铺名称, 完成时间, 记录数量, 新增数量, 告警数量) {
  return {
    storeId: 店铺标识,
    storeName: 店铺名称,
    status: 'success',
    lastCheckedAt: 完成时间,
    metrics: { 警告订单数: 告警数量, 明细总数: 记录数量 },
    records: Array.from({ length: 记录数量 }, (_, 索引) => ({ id: `${店铺标识}-${索引}` })),
    newRecords: Array.from({ length: 新增数量 }, (_, 索引) => ({ id: `${店铺标识}-new-${索引}` })),
  };
}

test('首页摘要应该汇总单店巡检的关键数量', () => {
  const 摘要 = 构建命令行巡检摘要({
    执行类型: 'single',
    开始时间: '2026-08-03T08:00:00.000Z',
    完成时间: '2026-08-03T08:01:00.000Z',
    店铺列表: [{ id: 'store-a', name: '京东一店' }],
    店铺结果列表: [构建成功店铺结果('store-a', '京东一店', '2026-08-03T08:01:00.000Z', 8, 2, 1)],
  });

  assert.equal(摘要.status, 'success');
  assert.equal(摘要.executionType, 'single');
  assert.equal(摘要.storeCount, 1);
  assert.equal(摘要.checkedStoreCount, 1);
  assert.equal(摘要.识别记录数, 8);
  assert.equal(摘要.新增记录数, 2);
  assert.equal(摘要.告警记录数, 1);
});

test('首页摘要应该保留批量失败店铺并汇总全部数据', () => {
  const 摘要 = 构建命令行巡检摘要({
    执行类型: 'batch',
    开始时间: '2026-08-03T08:00:00.000Z',
    完成时间: '2026-08-03T08:03:00.000Z',
    店铺列表: [
      { id: 'store-a', name: '京东一店' },
      { id: 'store-b', name: '京东二店' },
    ],
    店铺结果列表: [
      构建成功店铺结果('store-a', '京东一店', '2026-08-03T08:01:00.000Z', 3, 1, 0),
      { storeId: 'store-b', storeName: '京东二店', status: 'error', lastCheckedAt: '2026-08-03T08:02:00.000Z', lastMessage: '登录失败' },
    ],
  });

  assert.equal(摘要.status, 'error');
  assert.equal(摘要.failedStoreCount, 1);
  assert.deepEqual(摘要.failedStoreNames, ['京东二店']);
  assert.equal(摘要.识别记录数, 3);
  assert.equal(摘要.新增记录数, 1);
});

test('首页应该优先显示刚保存的最近CLI摘要', () => {
  const 最近摘要 = {
    executionType: 'single',
    status: 'success',
    finishedAt: '2026-08-03T08:01:00.000Z',
    storeCount: 1,
  };
  const 结果 = 获取最近命令行巡检摘要({
    配置: { stores: [] },
    结果对象: { lastRunSummary: 最近摘要, lastBatchSummary: null, stores: {} },
  });

  assert.strictEqual(结果, 最近摘要);
});

test('首页摘要应该使用不同颜色通道输出成功和告警状态', () => {
  const 输出内容 = [];
  const 终端 = 构建测试终端();
  const 摘要 = 构建命令行巡检摘要({
    执行类型: 'single',
    完成时间: '2026-08-03T08:01:00.000Z',
    店铺列表: [{ id: 'store-a', name: '京东一店' }],
    店铺结果列表: [构建成功店铺结果('store-a', '京东一店', '2026-08-03T08:01:00.000Z', 2, 1, 1)],
  });

  输出巡检摘要({ 摘要, 输出: (内容) => 输出内容.push(内容), 终端 });

  assert.match(输出内容.join('\n'), /最近巡检总览/);
  assert.match(输出内容.join('\n'), /巡检成功/);
  assert.match(输出内容.join('\n'), /识别 2 条｜新增 1 条｜告警 1 条/);
});

test('巡检失败结果应明确显示失败原因而不是完成', () => {
  const 输出内容 = [];
  输出巡检结果(
    { storeName: '京东一店', status: 'error', lastMessage: '登录失效' },
    (内容) => 输出内容.push(内容),
    构建测试终端(),
  );

  assert.equal(输出内容.length, 1);
  assert.match(输出内容[0], /^\[失败\] 京东一店：登录失效$/);
  assert.doesNotMatch(输出内容[0], /\[完成\]/);
});
