const { EventEmitter } = require('events');

class ControlCenterState {
  constructor(初始结果 = {}, 初始订单记录 = []) {
    this.eventBus = new EventEmitter();
    this.logLines = [];
    this.currentTask = null;
    this.storeResults = { ...(初始结果.stores || {}) };
    this.lastBatchSummary = 初始结果.lastBatchSummary || null;
    this.lastSingleSummary = 初始结果.lastSingleSummary || null;
    this.orderRecords = Array.isArray(初始订单记录) ? 初始订单记录.slice() : [];
    this.invoiceReturnReport = {
      status: 'idle',
      summaryMessage: '暂无发票回传任务。',
      items: [],
      updatedAt: '',
    };
    this.maxLogLines = 200;
  }

  appendLog(line) {
    // 解决：日志只广播日志事件，避免每行日志都触发首页全量重绘。
    this.logLines.push(line);
    if (this.logLines.length > this.maxLogLines) {
      this.logLines.shift();
    }
    this.eventBus.emit('log', { line });
  }

  setTask(task) {
    // 解决：任务状态单独广播，界面只更新任务摘要和按钮状态。
    this.currentTask = task;
    this.eventBus.emit('task', { currentTask: this.currentTask });
  }

  updateStoreResult(storeResult) {
    // 解决：单店结果只推送当前店铺，避免每次都传整套运行状态。
    this.storeResults[storeResult.storeId] = storeResult;
    this.eventBus.emit('store-result', { storeResult });
  }

  setOrderRecords(orderRecords) {
    // 解决：订单变化才推送订单列表，日志和任务状态不牵动订单看板。
    this.orderRecords = Array.isArray(orderRecords) ? orderRecords.slice() : [];
    this.eventBus.emit('order-records', { orderRecords: this.orderRecords.slice() });
  }

  setInvoiceReturnReport(report) {
    // 解决：发票回传逐单报告独立推送，避免复用巡检报告造成业务状态混杂。
    this.invoiceReturnReport = {
      status: String(report?.status || 'idle'),
      summaryMessage: String(report?.summaryMessage || ''),
      items: Array.isArray(report?.items) ? report.items.slice() : [],
      updatedAt: String(report?.updatedAt || new Date().toISOString()),
    };
    this.eventBus.emit('invoice-return-report', { invoiceReturnReport: this.invoiceReturnReport });
  }

  setBatchSummary(summary) {
    // 解决：运行中的批量总览和磁盘上的最近总览保持同一份事实。
    this.lastBatchSummary = summary || null;
    this.eventBus.emit('batch-summary', { summary: this.lastBatchSummary });
  }

  setSingleSummary(summary) {
    // 解决：运行中的单店结果单独更新，不覆盖批量总览。
    this.lastSingleSummary = summary || null;
    this.eventBus.emit('single-summary', { summary: this.lastSingleSummary });
  }

  getSnapshot() {
    // 解决：只向前端暴露渲染所需的最小状态，避免运行期对象泄露。
    return {
      currentTask: this.currentTask,
      lastBatchSummary: this.lastBatchSummary,
      lastSingleSummary: this.lastSingleSummary,
      logLines: this.logLines.slice(),
      storeResults: Object.values(this.storeResults).sort((a, b) => String(a.storeName).localeCompare(String(b.storeName), 'zh-CN')),
      orderRecords: this.orderRecords.slice(),
      invoiceReturnReport: {
        ...this.invoiceReturnReport,
        items: this.invoiceReturnReport.items.slice(),
      },
    };
  }
}

module.exports = {
  ControlCenterState,
};
