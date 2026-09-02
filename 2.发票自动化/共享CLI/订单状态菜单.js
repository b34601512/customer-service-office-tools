// 该文件用于解决各业务平台进入四个人工状态队列后直接看单、按阶段限定动作并原地刷新的问题。

const {
  工作流状态,
  工作流状态中文,
  读取工作流状态,
  读取本地处理阶段,
  读取平台状态,
  获取订单统计,
  筛选订单,
  订单匹配搜索,
} = require('../共享订单状态/orderWorkflow');
const { 跳过自动暂停结果 } = require('./命令行核心');

const 队列选择映射 = Object.freeze({
  1: 工作流状态.待处理,
  2: 工作流状态.处理中,
  3: 工作流状态.发票已登记,
  4: 工作流状态.已处理,
});
const 默认订单每页条数 = 10;

function 显示订单页面({ 终端, 输出, 标题, 副标题 = '' }) {
  if (typeof 终端?.显示页面 === 'function') {
    终端.显示页面(标题, 副标题);
    return;
  }
  终端?.清屏?.();
  if (typeof 终端?.输出标题 === 'function') {
    终端.输出标题(标题, 副标题);
    return;
  }
  输出(`[页面] ${标题}${副标题 ? `｜${副标题}` : ''}`);
}

function 格式化页面反馈(终端, text) {
  if (String(text).startsWith('[失败]')) return 终端?.主题?.失败?.(text) || text;
  if (String(text).startsWith('[提示]')) return 终端?.主题?.提醒?.(text) || text;
  return 终端?.主题?.成功?.(text) || text;
}

function 构建订单分页(orderList = [], pageNumber = 1, pageSize = 默认订单每页条数) {
  // 队列每次只渲染一页；状态变化后重新读取仓库并夹紧页码，避免空白页和旧数据。
  const list = Array.isArray(orderList) ? orderList : [];
  const 每页条数 = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 默认订单每页条数;
  const 总页数 = Math.max(1, Math.ceil(list.length / 每页条数));
  const 当前页码 = Math.min(Math.max(Number.parseInt(pageNumber, 10) || 1, 1), 总页数);
  const 起始索引 = (当前页码 - 1) * 每页条数;
  return {
    当前页码,
    总页数,
    每页条数,
    起始索引,
    当前页订单: list.slice(起始索引, 起始索引 + 每页条数),
  };
}

function 构建状态动作(workflowStatus) {
  const status = String(workflowStatus || '').trim();
  const actions = {
    [工作流状态.待处理]: [
      { label: '标记处理中', targetStatus: 工作流状态.处理中 },
    ],
    [工作流状态.处理中]: [
      { label: '标记发票已登记', targetStatus: 工作流状态.发票已登记 },
      { label: '标记已处理', targetStatus: 工作流状态.已处理 },
      { label: '恢复待处理', targetStatus: 工作流状态.待处理 },
    ],
    [工作流状态.发票已登记]: [
      { label: '标记已处理', targetStatus: 工作流状态.已处理 },
      { label: '恢复处理中', targetStatus: 工作流状态.处理中 },
    ],
    [工作流状态.已处理]: [
      { label: '恢复到发票已登记', targetStatus: 工作流状态.发票已登记 },
    ],
  };
  return [...actions[status] || []];
}

function 构建四队列统计文字(orderList = []) {
  const stats = 获取订单统计(orderList);
  return `待处理 ${stats.pending}｜处理中 ${stats.processing}｜发票已登记 ${stats.invoiceRegistered}｜已处理 ${stats.handled}`;
}

function 格式化订单行(order, index, options = {}) {
  const platformStatus = typeof options.读取平台状态 === 'function'
    ? options.读取平台状态(order)
    : 读取平台状态(order);
  const formatExtra = options.格式化队列附加信息 || options.格式化附加信息;
  const extraText = typeof formatExtra === 'function'
    ? String(formatExtra(order) || '').trim()
    : '';
  return `[${index + 1}] ${order.storeName || '-'}｜${order.orderNumber || order.key || '-'}｜人工：${读取本地处理阶段(order)}｜平台：${platformStatus?.text || '未同步'}${extraText ? `｜${extraText}` : ''}`;
}

function 输出订单队列({
  输出,
  终端 = null,
  orderList = [],
  workflowStatus,
  searchText = '',
  pageNumber = 1,
  pageSize = 默认订单每页条数,
  ...options
}) {
  const label = 工作流状态中文[workflowStatus] || workflowStatus;
  const pagination = 构建订单分页(orderList, pageNumber, pageSize);
  输出(`[队列] ${label}｜${orderList.length} 条｜第 ${pagination.当前页码}/${pagination.总页数} 页${searchText ? `｜搜索：${searchText}` : ''}`);
  if (!orderList.length) {
    const emptyText = `当前没有${label}订单。`;
    输出(终端?.主题?.弱化?.(emptyText) || emptyText);
    return pagination;
  }
  pagination.当前页订单.forEach((order, index) => 输出(格式化订单行(order, pagination.起始索引 + index, options)));
  return pagination;
}

function 规范化额外动作(rawActions) {
  return (Array.isArray(rawActions) ? rawActions : []).filter((action) => action && typeof action.label === 'string' && typeof action.execute === 'function');
}

async function 处理单个订单(options) {
  // 订单详情是独立视图，保存后返回并重绘原队列，不把操作过程追加在列表下方。
  const {
    order,
    提问器,
    输出,
    更新订单状态,
    更新订单备注 = null,
    复制订单号 = null,
    构建额外动作 = null,
    读取平台状态: 读取平台状态方法 = 读取平台状态,
    终端 = null,
    设置页面反馈 = null,
  } = options;
  const workflowStatus = 读取工作流状态(order);
  const primaryActions = 构建状态动作(workflowStatus);
  const secondaryActions = [];
  if (typeof 更新订单备注 === 'function') {
    secondaryActions.push({
      label: '修改备注',
      execute: async () => 更新订单备注(order.key, await 提问器.询问('订单备注（留空即清除）：')),
    });
  }
  if (typeof 复制订单号 === 'function') {
    secondaryActions.push({
      label: '复制订单号',
      execute: async () => 复制订单号(order.orderNumber),
    });
  }
  if (typeof 构建额外动作 === 'function') {
    secondaryActions.push(...规范化额外动作(构建额外动作(order)));
  }

  let 页面提示 = '';
  while (true) {
    显示订单页面({
      终端,
      输出,
      标题: `订单详情 · ${order.orderNumber || order.key}`,
      副标题: order.storeName || '未命名店铺',
    });
    输出(`人工阶段：${读取本地处理阶段(order)}｜平台状态：${读取平台状态方法(order).text}`);
    const formatExtra = options.格式化详情附加信息 || options.格式化附加信息;
    const extraText = typeof formatExtra === 'function'
      ? String(formatExtra(order) || '').trim()
      : '';
    if (extraText) 输出(extraText);
    if (页面提示) 输出(格式化页面反馈(终端, 页面提示));
    输出('');
    primaryActions.forEach((action, index) => 输出(`  [${index + 1}] ${action.label}`));
    secondaryActions.forEach((action, index) => 输出(`  [${primaryActions.length + index + 1}] ${action.label}`));
    输出('  [0] 返回队列');
    const choice = (await 提问器.询问('请选择：')).trim();
    if (choice === '0' || !choice) return false;
    const actionIndex = Number.parseInt(choice, 10) - 1;
    if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= primaryActions.length + secondaryActions.length) {
      页面提示 = '[提示] 订单操作无效，请输入当前页面显示的编号。';
      continue;
    }
    try {
      if (actionIndex < primaryActions.length) {
        const action = primaryActions[actionIndex];
        await Promise.resolve(更新订单状态(order.key, action.targetStatus));
      } else {
        await secondaryActions[actionIndex - primaryActions.length].execute({ order, 提问器, 输出 });
      }
    } catch (error) {
      页面提示 = `[失败] ${error.message}`;
      continue;
    }
    const 完成提示 = '[完成] 订单记录已保存，当前队列已刷新。';
    if (typeof 设置页面反馈 === 'function') 设置页面反馈(完成提示);
    else 输出(完成提示);
    return true;
  }
}

async function 打开订单队列(options) {
  const {
    workflowStatus,
    读取订单列表,
    提问器,
    输出,
    终端 = null,
  } = options;
  let searchText = '';
  let pageNumber = 1;
  let 页面反馈 = '';
  while (true) {
    const allOrders = await Promise.resolve(读取订单列表());
    const currentOrders = 筛选订单(allOrders, workflowStatus).filter((order) => 订单匹配搜索(order, searchText));
    const label = 工作流状态中文[workflowStatus] || workflowStatus;
    显示订单页面({
      终端,
      输出,
      标题: `${label}订单`,
      副标题: 构建四队列统计文字(allOrders),
    });
    if (页面反馈) {
      输出(格式化页面反馈(终端, 页面反馈));
      页面反馈 = '';
    }
    const pagination = 输出订单队列({
      ...options,
      输出,
      终端,
      orderList: currentOrders,
      workflowStatus,
      searchText,
      pageNumber,
    });
    pageNumber = pagination.当前页码;
    输出('');
    const 导航提示 = pagination.总页数 > 1 ? '｜n 下一页｜p 上一页' : '';
    const 订单提示 = currentOrders.length ? `订单序号${导航提示}｜s 搜索｜0 返回：` : 's 搜索｜0 返回：';
    const choice = (await 提问器.询问(订单提示)).trim();
    if (choice === '0' || !choice) return;
    if (choice.toLowerCase() === 's') {
      searchText = (await 提问器.询问('搜索店铺、订单号、备注或平台状态（留空清除搜索）：')).trim();
      pageNumber = 1;
      continue;
    }
    if (choice.toLowerCase() === 'n') {
      if (pageNumber < pagination.总页数) pageNumber += 1;
      else 页面反馈 = '[提示] 已经是最后一页。';
      continue;
    }
    if (choice.toLowerCase() === 'p') {
      if (pageNumber > 1) pageNumber -= 1;
      else 页面反馈 = '[提示] 已经是第一页。';
      continue;
    }
    const index = Number.parseInt(choice, 10) - 1;
    const 当前页末尾索引 = pagination.起始索引 + pagination.当前页订单.length;
    if (!Number.isInteger(index) || index < pagination.起始索引 || index >= 当前页末尾索引) {
      页面反馈 = '[提示] 订单序号无效，请输入当前页显示的编号。';
      continue;
    }
    await 处理单个订单({
      ...options,
      order: currentOrders[index],
      提问器,
      输出,
      终端,
      设置页面反馈: (反馈文字) => { 页面反馈 = 反馈文字; },
    });
  }
}

async function 打开订单状态管理(options = {}) {
  const { 读取订单列表, 提问器, 输出, 终端 = null } = options;
  if (typeof 读取订单列表 !== 'function') throw new Error('订单状态管理失败：缺少订单读取方法。');
  if (typeof options.更新订单状态 !== 'function') throw new Error('订单状态管理失败：缺少状态更新方法。');
  let 页面反馈 = '';
  while (true) {
    const orders = await Promise.resolve(读取订单列表());
    const stats = 获取订单统计(orders);
    显示订单页面({ 终端, 输出, 标题: '订单状态管理', 副标题: '选择阶段后直接进入对应订单队列。' });
    if (页面反馈) {
      输出(终端?.主题?.提醒?.(页面反馈) || 页面反馈);
      页面反馈 = '';
    }
    输出(`[订单状态] ${构建四队列统计文字(orders)}`);
    输出(`  [1] 待处理（${stats.pending}）`);
    输出(`  [2] 处理中（${stats.processing}）`);
    输出(`  [3] 发票已登记（${stats.invoiceRegistered}）`);
    输出(`  [4] 已处理（${stats.handled}）`);
    输出('  [0] 返回');
    const choice = (await 提问器.询问('请选择状态队列：')).trim();
    if (choice === '0' || !choice) return 跳过自动暂停结果;
    const workflowStatus = 队列选择映射[choice];
    if (!workflowStatus) {
      页面反馈 = '[提示] 状态队列选择无效。';
      continue;
    }
    await 打开订单队列({ ...options, workflowStatus });
  }
}

module.exports = {
  队列选择映射,
  默认订单每页条数,
  显示订单页面,
  格式化页面反馈,
  构建订单分页,
  构建状态动作,
  构建四队列统计文字,
  格式化订单行,
  输出订单队列,
  处理单个订单,
  打开订单队列,
  打开订单状态管理,
};
