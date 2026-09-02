const test = require('node:test');
const assert = require('node:assert/strict');
const {
  创建平台回传CLI动作,
  构建限量店铺结果行,
} = require('./platformReturnWorkbench');

function 创建上下文(answers = []) {
  const output = [];
  const logs = [];
  const pages = [];
  return {
    output,
    logs,
    pages,
    context: {
      输出: (text) => output.push(text),
      终端: { 显示页面: (title) => pages.push(title) },
      提问器: { 询问: async () => answers.shift() || '' },
      记录运行日志: (text) => logs.push(text),
    },
  };
}

test('只读同步单店失败后继续并输出汇总', async () => {
  const stores = [{ id: 'a', name: 'A店' }, { id: 'b', name: 'B店' }];
  const workbench = 创建平台回传CLI动作({
    platformName: '模拟平台',
    获取启用店铺列表: () => stores,
    读取订单列表: () => [],
    选择店铺方法: async () => stores,
    同步单个店铺: async ({ 店铺配置 }) => {
      if (店铺配置.id === 'a') throw new Error('登录失效');
      return { message: '同步完成', orderCount: 2, addedCount: 2 };
    },
  });
  const { context, output, logs, pages } = 创建上下文();
  const reports = await workbench.同步待处理订单(context);

  assert.deepEqual(reports.map((item) => item.status), ['error', 'success']);
  assert.equal(output.some((line) => line.includes('继续下一家')), true);
  assert.equal(output.some((line) => line.includes('成功 1/2 家')), true);
  assert.equal(logs.some((line) => line.includes('登录失效')), true);
  assert.equal(pages.at(-1), '模拟平台 · 同步结果');
});

test('正式回传仅消费已登记队列，多店失败后继续并汇总逐单结果', async () => {
  const stores = [{ id: 'a', name: 'A店' }, { id: 'b', name: 'B店' }];
  const orders = {
    a: [{ key: 'a:1', storeId: 'a', orderNumber: '1', workflowStatus: 'invoice_registered' }],
    b: [{ key: 'b:2', storeId: 'b', orderNumber: '2', workflowStatus: 'invoice_registered' }],
  };
  const attempts = [];
  const workbench = 创建平台回传CLI动作({
    platformName: '模拟平台',
    获取启用店铺列表: () => stores,
    读取订单列表: () => Object.values(orders).flat(),
    读取店铺发票已登记订单: (store) => orders[store.id],
    选择店铺方法: async () => stores,
    设置订单回传尝试: (key, attempt) => attempts.push({ key, ...attempt }),
    执行正式回传: async ({ 店铺配置, orders: selected, onProgress }) => {
      if (店铺配置.id === 'a') throw new Error('A店页面失败');
      onProgress({ type: 'item', status: 'success', message: '成功', item: selected[0] });
      return { status: 'success', items: [{ ...selected[0], status: 'success', message: '成功' }] };
    },
  });
  const { context, output, logs, pages } = 创建上下文();
  const report = await workbench.正式回传(context);

  assert.equal(report.stores.length, 2);
  assert.equal(report.summary.storeError, 1);
  assert.equal(report.summary.storeSuccess, 1);
  assert.equal(attempts.some((item) => item.key === 'a:1' && item.status === 'error'), true);
  assert.equal(attempts.some((item) => item.key === 'b:2' && item.status === 'success'), true);
  assert.equal(output.some((line) => line.includes('模拟平台回传汇总')), true);
  assert.equal(output.some((line) => line.includes('[订单] B店｜2｜success')), false);
  assert.equal(logs.some((line) => line.includes('[订单] B店｜2｜success')), true);
  assert.equal(pages.at(-1), '模拟平台 · 回传结果');
});

test('没有已登记订单时跳过且不会执行平台回传或询问问题', async () => {
  let executed = false;
  const store = { id: 'a', name: 'A店' };
  const workbench = 创建平台回传CLI动作({
    platformName: '模拟平台',
    获取启用店铺列表: () => [store],
    读取订单列表: () => [],
    读取店铺发票已登记订单: () => [],
    选择店铺方法: async () => [store],
    执行正式回传: async () => { executed = true; },
  });
  const output = [];
  const result = await workbench.正式回传({
    输出: (text) => output.push(text),
    终端: {},
    提问器: { 询问: async () => { throw new Error('正式回传不应询问任何问题。'); } },
  });

  assert.equal(executed, false);
  assert.equal(result.summary.orderTotal, 0);
});

test('一键发票回传先同步全部店铺再正式回传，只选择一次店铺', async () => {
  const stores = [{ id: 'a', name: 'A店' }, { id: 'b', name: 'B店' }];
  const orders = {
    a: [{ key: 'a:1', storeId: 'a', orderNumber: '1' }],
    b: [{ key: 'b:2', storeId: 'b', orderNumber: '2' }],
  };
  const 选择次数 = [];
  const synced = [];
  const returned = [];
  const workbench = 创建平台回传CLI动作({
    platformName: '模拟平台',
    获取启用店铺列表: () => stores,
    读取订单列表: () => Object.values(orders).flat(),
    读取店铺发票已登记订单: (store) => orders[store.id],
    选择店铺方法: async () => { 选择次数.push(1); return stores; },
    回传要求已登记: false,
    同步单个店铺: async ({ 店铺配置 }) => { synced.push(店铺配置.id); return { message: '同步完成', orderCount: 1, addedCount: 1 }; },
    设置订单回传尝试: () => {},
    执行正式回传: async ({ 店铺配置, orders: selected, onProgress }) => {
      returned.push(店铺配置.id);
      onProgress({ type: 'item', status: 'success', message: '成功', item: selected[0] });
      return { status: 'success', items: [{ ...selected[0], status: 'success', message: '成功' }] };
    },
  });
  const { context, output, logs, pages } = 创建上下文();
  const report = await workbench.一键发票回传(context);

  assert.deepEqual(选择次数, [1]);
  assert.deepEqual(synced, ['a', 'b']);
  assert.deepEqual(returned, ['a', 'b']);
  assert.equal(report.summary.storeTotal, 2);
  assert.equal(report.summary.storeSuccess, 2);
  assert.equal(logs.some((line) => line.includes('同步完成')), true);
  assert.equal(pages.at(-1), '模拟平台 · 回传结果');
});

test('多店最终结果页最多展示十家，其余明细引导到独立日志', () => {
  const reports = Array.from({ length: 12 }, (_, index) => ({ storeName: `店铺${index + 1}` }));
  const lines = 构建限量店铺结果行(reports, (item) => item.storeName);

  assert.equal(lines.length, 11);
  assert.equal(lines[9], '店铺10');
  assert.match(lines[10], /另有 2 家店铺明细/);
});
