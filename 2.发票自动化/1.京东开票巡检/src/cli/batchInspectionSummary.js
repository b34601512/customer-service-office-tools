// 该文件用于构建 CLI 批量巡检的最终摘要与完成提示。

function 取店铺显示名(店铺 = {}) {
  // 解决：批量结论里优先展示用户能认出来的店铺名称。
  return String(店铺.name || 店铺.storeName || 店铺.id || 店铺.storeId || '未命名店铺').trim();
}

function 取店铺标识(店铺 = {}) {
  // 解决：批量摘要必须按稳定 id 对齐配置和巡检结果，避免同名店铺串结果。
  return String(店铺.id || 店铺.storeId || 店铺.name || 店铺.storeName || '').trim();
}

function 建立结果索引(storeResults = []) {
  // 解决：把结果列表转换成可按店铺 id 快速查找的结构。
  const resultByStoreId = new Map();
  for (const result of Array.isArray(storeResults) ? storeResults : []) {
    const storeId = 取店铺标识(result);
    if (storeId) {
      resultByStoreId.set(storeId, result);
    }
  }
  return resultByStoreId;
}

function 是已完成店铺状态(status) {
  // 解决：只把成功或失败视为这家店铺已经完成一次明确排查。
  return status === 'success' || status === 'error';
}

function 构建批量巡检摘要(选项 = {}) {
  // 解决：把一次“全部店铺排查”的最终事实固化下来，首页不用再猜结束时间和结论。
  const {
    startedAt = '',
    finishedAt = new Date().toISOString(),
    enabledStores = [],
    storeResults = [],
  } = 选项;
  const 店铺列表 = Array.isArray(enabledStores) ? enabledStores : [];
  const resultByStoreId = 建立结果索引(storeResults);
  const failedStoreNames = [];
  const uncheckedStoreNames = [];
  let successStoreCount = 0;
  let checkedStoreCount = 0;

  for (const 店铺 of 店铺列表) {
    const storeId = 取店铺标识(店铺);
    const result = resultByStoreId.get(storeId);
    const storeName = 取店铺显示名(店铺);

    if (!result || !是已完成店铺状态(result.status)) {
      uncheckedStoreNames.push(storeName);
      continue;
    }

    checkedStoreCount += 1;
    if (result.status === 'success') {
      successStoreCount += 1;
    } else {
      failedStoreNames.push(storeName);
    }
  }

  const storeCount = 店铺列表.length;
  const failedStoreCount = failedStoreNames.length;
  const uncheckedStoreCount = uncheckedStoreNames.length;
  const status = failedStoreCount > 0 || uncheckedStoreCount > 0 ? 'error' : 'success';

  return {
    version: 1,
    taskName: 'all',
    status,
    resultLabel: status === 'success' ? '巡检成功' : '巡检有问题',
    startedAt,
    finishedAt,
    storeCount,
    checkedStoreCount,
    successStoreCount,
    failedStoreCount,
    uncheckedStoreCount,
    failedStoreNames,
    uncheckedStoreNames,
  };
}

function 构建批量任务完成消息(summary = {}) {
  // 解决：顶部任务状态区明确区分“跑完”和“跑完但有问题”。
  if (summary.status === 'success') {
    return `任务完成：all，${summary.storeCount || 0} 家店铺已全部排查。`;
  }

  const 问题片段 = [];
  if ((summary.failedStoreCount || 0) > 0) {
    问题片段.push(`失败 ${summary.failedStoreCount} 家`);
  }
  if ((summary.uncheckedStoreCount || 0) > 0) {
    问题片段.push(`未完成 ${summary.uncheckedStoreCount} 家`);
  }

  return `任务完成但有问题：all，${问题片段.join('，') || '请查看巡检结论'}`;
}

module.exports = {
  构建批量巡检摘要,
  构建批量任务完成消息,
};
