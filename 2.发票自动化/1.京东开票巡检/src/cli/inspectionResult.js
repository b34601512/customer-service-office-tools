function 构建成功店铺结果({ 店铺, 巡检结果 }) {
  // 解决：把CLI巡检结果保存成后台和首页都能识别的统一结构。
  return {
    storeId: 店铺.id,
    storeName: 店铺.name,
    status: 'success',
    statusLabel: '排查完成',
    lastMessage: `排查完成：告警=${巡检结果.metrics?.警告订单数 ?? 0}，待登记=${巡检结果.metrics?.待登记明细数 ?? 0}，已上传未逾期=${巡检结果.metrics?.已上传未逾期数 ?? 0}，明细=${巡检结果.metrics?.明细总数 ?? 0}，新增=${巡检结果.newRecords?.length || 0}`,
    lastCheckedAt: 巡检结果.checkedAt || new Date().toISOString(),
    metrics: 巡检结果.metrics || {},
    records: Array.isArray(巡检结果.records) ? 巡检结果.records : [],
    newRecords: Array.isArray(巡检结果.newRecords) ? 巡检结果.newRecords : [],
    preview: 巡检结果.pagePreview || '',
    reportPath: 巡检结果.reportPath || '',
  };
}

function 构建失败店铺结果({ 店铺, 错误 }) {
  // 解决：CLI失败也写入首页摘要，让用户能看到哪家店铺出了问题。
  return {
    storeId: 店铺.id,
    storeName: 店铺.name,
    status: 'error',
    statusLabel: '排查失败',
    lastMessage: String(错误?.message || 错误 || '排查失败'),
    lastCheckedAt: new Date().toISOString(),
    metrics: null,
    records: [],
    newRecords: [],
    preview: '',
    reportPath: '',
  };
}

module.exports = {
  构建成功店铺结果,
  构建失败店铺结果,
};
