function 构建失败店铺结果(店铺, 错误) {
  // 解决：失败结果结构集中生成，避免重试和最终失败写出不同字段。
  const 页面诊断 = 错误?.pageDiagnostic || {};
  return {
    storeId: 店铺.id,
    storeName: 店铺.name,
    status: 'error',
    statusLabel: '识别失败',
    lastMessage: String(错误?.message || 错误 || '识别失败'),
    lastCheckedAt: new Date().toISOString(),
    pageTitle: 页面诊断.pageTitle || '',
    pageUrl: 页面诊断.pageUrl || '',
    metrics: null,
    records: [],
    newRecords: [],
    preview: 页面诊断.pagePreview || '',
    screenshotPath: 页面诊断.screenshotPath || '',
    reportPath: '',
  };
}

function 构建等待店铺结果(店铺) {
  // 解决：批量任务启动时先展示等待状态，避免用户以为后续店铺漏跑。
  return {
    storeId: 店铺.id,
    storeName: 店铺.name,
    status: 'queued',
    statusLabel: '等待识别',
    lastMessage: '已进入本轮批量识别队列，等待前面的店铺完成。',
    lastCheckedAt: new Date().toISOString(),
    metrics: null,
    records: [],
    newRecords: [],
    preview: '',
    screenshotPath: '',
    reportPath: '',
  };
}

function 构建运行中店铺结果(店铺, 可见模式) {
  // 解决：单店开始时统一生成运行中状态，界面只关心当前阶段。
  return {
    storeId: 店铺.id,
    storeName: 店铺.name,
    status: 'running',
    statusLabel: 可见模式 ? '可见识别中' : '后台识别中',
    lastMessage: 可见模式 ? '正在打开可见浏览器并识别催票订单' : '正在后台识别催票订单',
    lastCheckedAt: new Date().toISOString(),
    metrics: null,
    records: [],
    preview: '',
  };
}

function 构建分页进度店铺结果(店铺, 可见模式, 进度) {
  // 解决：长分页读取时把真实页码进度推到巡检报告，避免用户只能看黑窗判断。
  return {
    storeId: 店铺.id,
    storeName: 店铺.name,
    status: 'running',
    statusLabel: 可见模式 ? '可见读取中' : '后台读取中',
    lastMessage: `正在读取京东接口：${进度.message}，每页=${进度.pageSize}，并发=${进度.concurrentPageCount}`,
    lastCheckedAt: new Date().toISOString(),
    metrics: null,
    records: [],
    preview: '',
    progress: 进度,
  };
}

function 构建等待登录店铺结果(店铺) {
  // 解决：自动补登录时把用户需要处理的店铺单独标出来。
  return {
    storeId: 店铺.id,
    storeName: 店铺.name,
    status: 'waiting-login',
    statusLabel: '等待登录',
    lastMessage: '检测到未登录，已打开该店铺登录页并自动提交账号密码；如京东要求滑块/验证码，请在窗口内人工完成。',
    lastCheckedAt: new Date().toISOString(),
    metrics: null,
    records: [],
    preview: '',
  };
}

function 构建成功店铺结果(店铺, 巡检结果) {
  // 解决：成功结果只保留巡检报告和后续排查需要的关键信息。
  return {
    storeId: 店铺.id,
    storeName: 店铺.name,
    status: 'success',
    statusLabel: '识别完成',
    lastMessage: `识别完成：扫描${巡检结果.metrics?.scannedPageCount ?? 1}页，后台发票订单=${巡检结果.metrics?.backendInvoiceOrderCount ?? 0}，已更新=${巡检结果.metrics?.backendInvoiceInfoUpdatedCount ?? 0}，催票=${巡检结果.records.length}，新增=${巡检结果.newRecords.length}，本地待处理=${巡检结果.metrics?.pendingOrderCount ?? 0}，处理中=${巡检结果.metrics?.processingOrderCount ?? 0}，发票已登记=${巡检结果.metrics?.invoiceRegisteredOrderCount ?? 0}，已处理=${巡检结果.metrics?.handledOrderCount ?? 0}`,
    lastCheckedAt: 巡检结果.checkedAt,
    metrics: 巡检结果.metrics,
    records: 巡检结果.records,
    newRecords: 巡检结果.newRecords,
    preview: 巡检结果.pagePreview,
    screenshotPath: 巡检结果.screenshotPath,
    reportPath: 巡检结果.reportPath || '',
  };
}

module.exports = {
  构建失败店铺结果,
  构建等待店铺结果,
  构建运行中店铺结果,
  构建分页进度店铺结果,
  构建等待登录店铺结果,
  构建成功店铺结果,
};
