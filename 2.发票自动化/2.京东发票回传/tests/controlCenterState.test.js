const test = require('node:test');
const assert = require('node:assert/strict');
const { ControlCenterState } = require('../src/controlCenter/controlCenterState');

function 记录事件(state, eventName) {
  // 该函数收集指定事件，验证状态层不会广播多余大包。
  const events = [];
  state.eventBus.on(eventName, (payload) => events.push(payload));
  return events;
}

test('日志追加只广播日志事件，不广播完整运行状态', () => {
  const state = new ControlCenterState();
  const logEvents = 记录事件(state, 'log');
  const taskEvents = 记录事件(state, 'task');
  const storeEvents = 记录事件(state, 'store-result');
  const orderEvents = 记录事件(state, 'order-records');
  const legacyStateEvents = 记录事件(state, 'state');

  state.appendLog('测试日志');

  assert.equal(logEvents.length, 1);
  assert.equal(logEvents[0].line, '测试日志');
  assert.equal(taskEvents.length, 0);
  assert.equal(storeEvents.length, 0);
  assert.equal(orderEvents.length, 0);
  assert.equal(legacyStateEvents.length, 0);
});

test('任务、店铺结果和订单记录分别广播小事件', () => {
  const state = new ControlCenterState();
  const taskEvents = 记录事件(state, 'task');
  const storeEvents = 记录事件(state, 'store-result');
  const orderEvents = 记录事件(state, 'order-records');

  state.setTask({ status: 'running', message: '正在识别' });
  state.updateStoreResult({ storeId: 'jd-1', storeName: '京东1店', status: 'running' });
  state.setOrderRecords([{ key: 'jd-1:1001', orderNumber: '1001' }]);

  assert.deepEqual(taskEvents[0].currentTask, { status: 'running', message: '正在识别' });
  assert.equal(storeEvents[0].storeResult.storeId, 'jd-1');
  assert.deepEqual(orderEvents[0].orderRecords.map((order) => order.orderNumber), ['1001']);
});
