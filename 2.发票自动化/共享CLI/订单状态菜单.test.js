// 该文件用于验证四个直接队列、空队列提示、阶段限定动作和操作后原队列刷新。

const test = require('node:test');
const assert = require('node:assert/strict');
const { 工作流状态 } = require('../共享订单状态/orderWorkflow');
const {
  构建状态动作,
  构建订单分页,
  输出订单队列,
  打开订单状态管理,
} = require('./订单状态菜单');

function 创建提问器(answers) {
  const prompts = [];
  return {
    prompts,
    async 询问(prompt) {
      prompts.push(prompt);
      if (!answers.length) throw new Error('测试输入不足。');
      return answers.shift();
    },
  };
}

test('每个阶段只显示当前有意义的状态动作', () => {
  assert.deepEqual(构建状态动作(工作流状态.待处理).map((item) => item.label), ['标记处理中']);
  assert.deepEqual(构建状态动作(工作流状态.处理中).map((item) => item.label), ['标记发票已登记', '标记已处理', '恢复待处理']);
  assert.deepEqual(构建状态动作(工作流状态.发票已登记).map((item) => item.label), ['标记已处理', '恢复处理中']);
  assert.deepEqual(构建状态动作(工作流状态.已处理).map((item) => item.label), ['恢复到发票已登记']);
});

test('空队列直接给出清晰中文提示', () => {
  const output = [];
  输出订单队列({
    输出: (text) => output.push(text),
    orderList: [],
    workflowStatus: 工作流状态.发票已登记,
  });
  assert.match(output.join('\n'), /当前没有发票已登记订单/);
});

test('长队列按固定页展示且序号保持全局连续', () => {
  const orders = Array.from({ length: 23 }, (_, index) => ({ orderNumber: String(index + 1) }));
  const page = 构建订单分页(orders, 2, 10);

  assert.equal(page.当前页码, 2);
  assert.equal(page.总页数, 3);
  assert.equal(page.起始索引, 10);
  assert.deepEqual(page.当前页订单.map((order) => order.orderNumber), ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20']);
});

test('选择待处理后先显示订单，不强制搜索，标记后原队列立即刷新', async () => {
  let orders = [{
    key: 's:1',
    storeName: '测试店',
    orderNumber: '1',
    workflowStatus: 工作流状态.待处理,
    platformStatus: { text: '平台待处理' },
  }];
  const output = [];
  const questioner = 创建提问器(['1', '1', '1', '0', '0']);
  const pages = [];

  await 打开订单状态管理({
    提问器: questioner,
    输出: (text) => output.push(text),
    终端: {
      显示页面: (title) => pages.push(title),
      主题: { 成功: (text) => text, 提醒: (text) => text, 弱化: (text) => text },
    },
    读取订单列表: () => orders,
    更新订单状态: (key, targetStatus) => {
      orders = orders.map((order) => order.key === key ? { ...order, workflowStatus: targetStatus } : order);
    },
  });

  assert.equal(questioner.prompts[0], '请选择状态队列：');
  assert.equal(questioner.prompts[1].startsWith('订单序号'), true);
  assert.equal(questioner.prompts.some((prompt) => prompt.startsWith('搜索店铺')), false);
  assert.match(output.join('\n'), /当前队列已刷新/);
  assert.match(output.join('\n'), /当前没有待处理订单/);
  assert.equal(orders[0].workflowStatus, 工作流状态.处理中);
  assert.deepEqual(pages.slice(0, 3), ['订单状态管理', '待处理订单', '订单详情 · 1']);
});
