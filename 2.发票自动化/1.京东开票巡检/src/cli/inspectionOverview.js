const { 构建批量巡检摘要 } = require('./batchInspectionSummary');
const { 格式化时间 } = require('../common/time');

function 规范化店铺结果列表(店铺结果来源) {
  if (Array.isArray(店铺结果来源)) return 店铺结果来源;
  if (店铺结果来源 && typeof 店铺结果来源 === 'object') return Object.values(店铺结果来源);
  return [];
}

function 读取结果时间(店铺结果) {
  return String(店铺结果?.lastCheckedAt || 店铺结果?.checkedAt || '').trim();
}

function 计算结果指标汇总(店铺结果列表) {
  return 店铺结果列表.reduce((汇总, 店铺结果) => {
    const 指标 = 店铺结果?.metrics || {};
    const 记录数量 = Array.isArray(店铺结果?.records)
      ? 店铺结果.records.length
      : Number(指标.明细总数 || 0);
    const 新增数量 = Array.isArray(店铺结果?.newRecords)
      ? 店铺结果.newRecords.length
      : 0;
    return {
      识别记录数: 汇总.识别记录数 + 记录数量,
      新增记录数: 汇总.新增记录数 + 新增数量,
      告警记录数: 汇总.告警记录数 + Number(指标.警告订单数 || 0),
    };
  }, { 识别记录数: 0, 新增记录数: 0, 告警记录数: 0 });
}

function 构建命令行巡检摘要({ 执行类型 = 'single', 开始时间 = '', 完成时间 = '', 店铺列表 = [], 店铺结果列表 = [] } = {}) {
  const 标准结果列表 = 规范化店铺结果列表(店铺结果列表);
  const 基础摘要 = 构建批量巡检摘要({
    startedAt: 开始时间,
    finishedAt: 完成时间 || new Date().toISOString(),
    enabledStores: 店铺列表,
    storeResults: 标准结果列表,
  });
  const 指标汇总 = 计算结果指标汇总(标准结果列表);
  return {
    ...基础摘要,
    taskName: 执行类型 === 'batch' ? 'all' : 'single',
    executionType: 执行类型,
    ...指标汇总,
  };
}

function 获取最近店铺结果(店铺结果列表) {
  return 店铺结果列表
    .filter((店铺结果) => 读取结果时间(店铺结果))
    .sort((左侧, 右侧) => new Date(读取结果时间(右侧)) - new Date(读取结果时间(左侧)))[0]
    || null;
}

function 获取最近命令行巡检摘要({ 配置 = {}, 结果对象 = {} } = {}) {
  if (结果对象.lastRunSummary) return 结果对象.lastRunSummary;

  const 店铺结果列表 = 规范化店铺结果列表(结果对象.stores);
  if (结果对象.lastBatchSummary) {
    return {
      ...结果对象.lastBatchSummary,
      executionType: 'batch',
      ...计算结果指标汇总(店铺结果列表),
    };
  }

  const 最近店铺结果 = 获取最近店铺结果(店铺结果列表);
  if (!最近店铺结果) return null;

  const 店铺 = (配置.stores || []).find((当前店铺) => 当前店铺.id === 最近店铺结果.storeId)
    || { id: 最近店铺结果.storeId, name: 最近店铺结果.storeName };
  return 构建命令行巡检摘要({
    执行类型: 'single',
    完成时间: 读取结果时间(最近店铺结果),
    店铺列表: [店铺],
    店铺结果列表: [最近店铺结果],
  });
}

function 格式化摘要时间(时间文本) {
  const 日期 = new Date(时间文本);
  return Number.isNaN(日期.getTime()) ? (时间文本 || '时间未知') : 格式化时间(日期);
}

function 输出巡检摘要({ 摘要, 输出, 终端 }) {
  if (!摘要) {
    输出(终端.主题.弱化('  最近巡检总览：暂无结果，请先执行一次巡检。'));
    return;
  }

  const 是否成功 = 摘要.status === 'success';
  const 状态文字 = 是否成功 ? 终端.主题.成功('[巡检成功]') : 终端.主题.失败('[巡检有问题]');
  const 执行类型文字 = 摘要.executionType === 'batch' ? '批量巡检' : '单店巡检';
  const 告警文字 = 摘要.告警记录数 > 0
    ? 终端.主题.失败(String(摘要.告警记录数))
    : 终端.主题.成功(String(摘要.告警记录数));
  const 失败文字 = 摘要.failedStoreCount > 0
    ? 终端.主题.失败(String(摘要.failedStoreCount))
    : 终端.主题.成功(String(摘要.failedStoreCount));

  输出(终端.主题.小标题('最近巡检总览'));
  输出(`  ${状态文字} ${终端.主题.弱化(`（${执行类型文字}）`)}`);
  输出(`  ${终端.主题.强调('完成时间')}：${格式化摘要时间(摘要.finishedAt)}`);
  输出(`  ${终端.主题.正文('店铺情况')}：总数 ${摘要.storeCount || 0}｜完成 ${摘要.checkedStoreCount || 0}｜成功 ${摘要.successStoreCount || 0}｜失败 ${失败文字}｜未完成 ${摘要.uncheckedStoreCount || 0}`);
  输出(`  ${终端.主题.正文('排查数据')}：识别 ${摘要.识别记录数 || 0} 条｜新增 ${摘要.新增记录数 || 0} 条｜告警 ${告警文字} 条`);

  const 问题店铺列表 = [...(摘要.failedStoreNames || []), ...(摘要.uncheckedStoreNames || [])];
  if (问题店铺列表.length) {
    输出(`  ${终端.主题.提醒('需要关注')}：${问题店铺列表.join('、')}`);
  }
}

function 输出首页巡检总览({ 输出, 终端, 配置, 结果对象 }) {
  输出('');
  输出巡检摘要({
    摘要: 获取最近命令行巡检摘要({ 配置, 结果对象 }),
    输出,
    终端,
  });
  输出('');
}

module.exports = {
  计算结果指标汇总,
  构建命令行巡检摘要,
  获取最近命令行巡检摘要,
  输出巡检摘要,
  输出首页巡检总览,
  格式化摘要时间,
};
