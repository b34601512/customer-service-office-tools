const { 格式化时间 } = require('../common/time');
const { 获取订单统计 } = require('../order/jdOrderRecordStore');
const { 构建批量摘要 } = require('../controlCenter/taskService/batchSummary');

function 规范化摘要(摘要) {
  if (!摘要 || typeof 摘要 !== 'object') return null;
  return 摘要;
}

function 格式化摘要时间(时间文本) {
  const 日期 = new Date(时间文本);
  return Number.isNaN(日期.getTime()) ? String(时间文本 || '时间未知') : 格式化时间(日期);
}

function 计算后台状态数量(订单列表 = []) {
  return (Array.isArray(订单列表) ? 订单列表 : []).reduce((统计, 订单) => {
    const 状态 = String(订单?.invoiceStatusKind || '').trim() || 'unknown';
    统计[状态] = Number(统计[状态] || 0) + 1;
    return 统计;
  }, {});
}

function 获取最近批量总览(结果对象 = {}) {
  return 规范化摘要(结果对象.lastBatchSummary);
}

function 获取最近单店总览(结果对象 = {}) {
  return 规范化摘要(结果对象.lastSingleSummary);
}

function 限定历史总览店铺(摘要, 配置 = {}, 订单列表 = []) {
  if (!摘要 || 摘要.executionType !== 'legacy' || !Array.isArray(配置.stores) || !配置.stores.length) {
    return 摘要;
  }
  const 店铺标识集合 = new Set(配置.stores.map((店铺) => String(店铺.id || '').trim()).filter(Boolean));
  const 店铺结果列表 = (摘要.storeResults || []).filter((店铺结果) => 店铺标识集合.has(String(店铺结果.storeId || '').trim()));
  const 结果时间列表 = 店铺结果列表.map((店铺结果) => String(店铺结果.lastCheckedAt || '').trim()).filter(Boolean).sort();
  const 限定摘要 = 构建批量摘要({
    开始时间: 结果时间列表[0] || 摘要.startedAt,
    完成时间: 结果时间列表.at(-1) || 摘要.finishedAt,
    店铺列表: 配置.stores,
    店铺结果列表,
    订单列表,
  });
  return {
    ...限定摘要,
    taskName: 'legacy-store-results',
    executionType: 'legacy',
    resultLabel: '历史店铺结果总览',
  };
}

function 输出订单总览({ 输出, 终端, 订单列表 }) {
  const 订单统计 = 获取订单统计(订单列表);
  const 后台状态统计 = 计算后台状态数量(订单列表);
  const 主题 = 终端?.主题;
  const 成功数量 = Number(后台状态统计.success || 0);
  const 待开票数量 = Number(后台状态统计.pending || 0);
  输出(`  ${主题?.正文?.('订单状态') || '订单状态'}：待处理 ${订单统计.pending}｜处理中 ${订单统计.processing}｜发票已登记 ${订单统计.invoiceRegistered}｜已处理 ${订单统计.handled}`);
  输出(`  ${主题?.正文?.('京东开票') || '京东开票'}：开票成功 ${成功数量}｜待开票 ${待开票数量}｜其他 ${Math.max(0, (订单列表 || []).length - 成功数量 - 待开票数量)}`);
}

function 输出单个识别总览(标题, 摘要, 输出, 终端) {
  if (!摘要) return;
  const 是否成功 = 摘要.status === 'success';
  const 主题 = 终端?.主题;
  const 状态文字 = 是否成功
    ? 主题?.成功?.('[完成]') || '[完成]'
    : 主题?.失败?.('[有问题]') || '[有问题]';
  const 执行类型文字 = 摘要.executionType === 'batch'
    ? '批量识别'
    : 摘要.executionType === 'single'
      ? '单店识别'
      : '历史店铺结果';
  输出(主题?.小标题?.(标题) || 标题);
  输出(`  ${状态文字} ${执行类型文字}｜开始 ${格式化摘要时间(摘要.startedAt)}｜结束 ${格式化摘要时间(摘要.finishedAt)}`);
  输出(`  店铺：总数 ${摘要.storeCount || 0}｜完成 ${摘要.checkedStoreCount || 0}｜成功 ${摘要.successStoreCount || 0}｜失败 ${摘要.failedStoreCount || 0}｜未完成 ${摘要.uncheckedStoreCount || 0}`);
  输出(`  催票：识别 ${摘要.scannedRecordCount || 0} 条｜新增 ${摘要.newRecordCount || 0} 条`);
  const 问题店铺列表 = [...(摘要.failedStoreNames || []), ...(摘要.uncheckedStoreNames || [])].filter(Boolean);
  if (问题店铺列表.length) {
    输出(`  ${主题?.提醒?.('需要关注') || '需要关注'}：${问题店铺列表.join('、')}`);
  }
}

function 输出首页总览({ 输出, 终端, 配置 = {}, 结果对象 = {}, 订单列表 = [] }) {
  const 批量摘要 = 限定历史总览店铺(获取最近批量总览(结果对象), 配置, 订单列表);
  const 单店摘要 = 获取最近单店总览(结果对象);
  输出('');
  if (批量摘要) {
    输出单个识别总览(批量摘要.executionType === 'legacy' ? '历史店铺结果总览' : '最近5店总览', 批量摘要, 输出, 终端);
  } else if (单店摘要) {
    输出单个识别总览('最近识别总览', 单店摘要, 输出, 终端);
  } else {
    输出(终端?.主题?.弱化?.('  最近识别总览：暂无记录，请先执行一次识别。') || '  最近识别总览：暂无记录，请先执行一次识别。');
  }
  if (批量摘要 && 单店摘要) {
    输出单个识别总览('最近单店记录', 单店摘要, 输出, 终端);
  }
  输出订单总览({ 输出, 终端, 订单列表 });
  输出(`  已配置店铺：${(配置.stores || []).length} 家｜启用 ${(配置.stores || []).filter((店铺) => 店铺.enabled !== false).length} 家`);
  输出('');
}

module.exports = {
  获取最近批量总览,
  获取最近单店总览,
  计算后台状态数量,
  输出首页总览,
};
