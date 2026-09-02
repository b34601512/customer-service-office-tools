// 统一总控制台只读状态汇总：读取各平台 data/ 摘要和下载中心本地状态文件。
// 这里绝不读取/输出密码等敏感字段，也不调用任何业务写入逻辑。
const fs = require('fs');
const path = require('path');
const { 子项目定义列表, 检查子项目入口 } = require('../总入口');

const 下载中心目录名称 = '3.通用发票下载中心';

const 平台数据规格 = {
  '1.京东开票巡检': {
    配置文件名: 'stores.json',
    订单状态文件名: 'invoice-order-state.json',
    结果文件名: 'store-results.json',
  },
  '2.京东发票回传': {
    配置文件名: 'stores.json',
    订单状态文件名: 'invoice-urge-orders.json',
    结果文件名: 'store-results.json',
  },
  '4.天猫发票回传': {
    配置文件名: 'stores.json',
    订单状态文件名: 'invoice-order-records.json',
    结果文件名: '',
  },
  '5.拼多多发票回传': {
    配置文件名: 'stores.json',
    订单状态文件名: 'invoice-order-records.json',
    结果文件名: '',
  },
  '6.抖音发票回传': {
    配置文件名: 'stores.json',
    订单状态文件名: 'invoice-order-records.json',
    结果文件名: '',
  },
};

function 读取JSON文件安全(文件路径) {
  try {
    if (!fs.existsSync(文件路径)) return null;
    const 数据 = JSON.parse(fs.readFileSync(文件路径, 'utf8'));
    return 数据 && typeof 数据 === 'object' ? 数据 : null;
  } catch {
    return null;
  }
}

function 读取店铺摘要(项目目录, 配置文件名 = 'stores.json') {
  const 文件路径 = path.join(项目目录, 'data', 配置文件名);
  const 配置 = 读取JSON文件安全(文件路径);
  const 店铺列表 = Array.isArray(配置?.stores) ? 配置.stores : [];
  const 启用店铺数 = 店铺列表.filter((店铺) => 店铺.enabled !== false).length;
  return {
    配置文件存在: Boolean(配置),
    店铺总数: 店铺列表.length,
    启用店铺数,
    店铺名称列表: 店铺列表.map((店铺) => String(店铺.name || 店铺.id || '未命名')),
  };
}

function 转换订单记录集合(订单数据) {
  if (Array.isArray(订单数据)) return 订单数据;
  if (订单数据?.orders && typeof 订单数据.orders === 'object') {
    return Object.values(订单数据.orders);
  }
  return [];
}

function 统计订单记录(订单列表) {
  const 计数 = {
    待处理: 0,
    处理中: 0,
    已登记: 0,
    已处理: 0,
    其他: 0,
  };
  let 失败尝试数 = 0;
  let 最近失败原因 = '';
  for (const 订单 of 订单列表) {
    const 状态 = String(订单?.workflowStatus || 'other');
    if (状态 === 'pending') 计数.待处理 += 1;
    else if (状态 === 'processing') 计数.处理中 += 1;
    else if (状态 === 'invoice_registered') 计数.已登记 += 1;
    else if (状态 === 'handled' || 状态 === 'done' || 状态 === 'success') 计数.已处理 += 1;
    else 计数.其他 += 1;

    const 最近尝试状态 = String(订单?.lastReturnAttempt?.status || '');
    if (最近尝试状态 === 'error') {
      失败尝试数 += 1;
      if (!最近失败原因) {
        最近失败原因 = String(订单.lastReturnAttempt.message || '有订单最近一次回传失败。').slice(0, 100);
      }
    }
  }
  return {
    订单总数: 订单列表.length,
    ...计数,
    失败尝试数,
    最近失败原因,
  };
}

function 读取订单摘要(项目目录, 订单状态文件名) {
  if (!订单状态文件名) {
    return { 订单文件存在: false, ...统计订单记录([]) };
  }
  const 文件路径 = path.join(项目目录, 'data', 订单状态文件名);
  const 订单数据 = 读取JSON文件安全(文件路径);
  return {
    订单文件存在: Boolean(订单数据),
    ...统计订单记录(转换订单记录集合(订单数据)),
  };
}

function 读取最近任务摘要(项目目录, 结果文件名) {
  if (!结果文件名) return { 任务记录存在: false, 状态: '暂无', 说明: '', 完成时间: '' };
  const 文件路径 = path.join(项目目录, 'data', 结果文件名);
  const 结果数据 = 读取JSON文件安全(文件路径);
  if (!结果数据) return { 任务记录存在: false, 状态: '暂无', 说明: '', 完成时间: '' };

  const 摘要 = 结果数据.lastRunSummary || 结果数据.lastBatchSummary || null;
  if (摘要) {
    const 状态文字 = String(摘要.status === 'success' ? '成功' : 摘要.status || '未知');
    const 成功数 = Number(摘要.successStoreCount ?? 摘要.checkedStoreCount ?? 0);
    const 店铺数 = Number(摘要.storeCount ?? 0);
    const 失败数 = Number(摘要.failedStoreCount ?? 0);
    return {
      任务记录存在: true,
      状态: 状态文字,
      说明: `${店铺数} 家店铺中完成 ${成功数} 家，失败 ${失败数} 家`,
      完成时间: String(摘要.finishedAt || 摘要.startedAt || ''),
    };
  }

  const 店铺结果对象 = 结果数据.stores && typeof 结果数据.stores === 'object' ? 结果数据.stores : {};
  const 店铺结果列表 = Object.values(店铺结果对象);
  const 成功数 = 店铺结果列表.filter((item) => item?.status === 'success').length;
  const 时间列表 = 店铺结果列表
    .map((item) => item?.lastCheckedAt)
    .filter(Boolean)
    .sort();
  return {
    任务记录存在: 店铺结果列表.length > 0,
    状态: 店铺结果列表.length > 0 ? `${成功数}/${店铺结果列表.length} 成功` : '暂无',
    说明: 店铺结果列表.length > 0 ? '按最近店铺结果统计' : '',
    完成时间: String(时间列表.at(-1) || ''),
  };
}

function 读取平台状态摘要(子项目定义, { 总目录 = path.resolve(__dirname, '..') } = {}) {
  const 入口检查 = 检查子项目入口(子项目定义, { 总目录, fileExists: fs.existsSync });
  const 项目目录 = path.join(总目录, 子项目定义.项目目录名称);
  const 规格 = 平台数据规格[子项目定义.项目目录名称] || {};
  const 店铺摘要 = 读取店铺摘要(项目目录, 规格.配置文件名);
  const 订单摘要 = 读取订单摘要(项目目录, 规格.订单状态文件名);
  const 最近任务 = 读取最近任务摘要(项目目录, 规格.结果文件名);
  return {
    ...入口检查,
    菜单编号: 子项目定义.菜单编号,
    项目名称: 子项目定义.项目名称,
    项目目录,
    ...店铺摘要,
    ...订单摘要,
    最近任务,
  };
}

function 读取所有平台状态摘要({ 总目录 = path.resolve(__dirname, '..'), 读取状态 = 读取平台状态摘要 } = {}) {
  return 子项目定义列表.map((子项目定义) => 读取状态(子项目定义, { 总目录 }));
}

function 读取下载中心状态摘要(总目录 = path.resolve(__dirname, '..')) {
  const 下载中心目录 = path.join(总目录, 下载中心目录名称);
  const 诺诺状态 = 读取JSON文件安全(path.join(下载中心目录, 'runtime', 'nuonuo-login-status.json'));
  const 配置 = 读取JSON文件安全(path.join(下载中心目录, 'data', 'invoice-system-config.json'));
  const 发票索引 = 读取JSON文件安全(path.join(下载中心目录, 'data', 'invoice-file-index.json'));
  const 进程登记 = 读取JSON文件安全(path.join(下载中心目录, 'runtime', 'process-registry.json'));

  const 发票对象 = 发票索引?.invoices && typeof 发票索引.invoices === 'object' ? 发票索引.invoices : {};
  const 进程列表 = Array.isArray(进程登记?.processes) ? 进程登记.processes : [];
  const 服务进程 = 进程列表.find((进程) => 进程?.role === 'service');
  return {
    目录存在: fs.existsSync(下载中心目录),
    下载中心目录,
    诺诺状态: 诺诺状态 || { status: 'unknown', label: '未检查', detail: '尚无登录检查记录' },
    账号已配置: Boolean(配置?.username && 配置?.provider),
    发票索引数: Object.keys(发票对象).length,
    服务进程: 服务进程 ? { pid: 服务进程.pid, label: 服务进程.label || '' } : null,
  };
}

module.exports = {
  下载中心目录名称,
  平台数据规格,
  读取JSON文件安全,
  读取店铺摘要,
  转换订单记录集合,
  统计订单记录,
  读取订单摘要,
  读取最近任务摘要,
  读取平台状态摘要,
  读取所有平台状态摘要,
  读取下载中心状态摘要,
};
