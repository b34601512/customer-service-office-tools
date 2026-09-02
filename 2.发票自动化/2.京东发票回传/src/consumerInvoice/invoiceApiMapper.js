function 补零(value) {
  // 解决：格式化日期时间时保证月份、日期和时分秒固定两位。
  return String(value).padStart(2, '0');
}

function 格式化接口时间(value) {
  // 解决：京东接口时间可能是毫秒时间戳或字符串，统一成页面展示用文本。
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' || /^\d{12,}$/.test(String(value))) {
    const date = new Date(Number(value));
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${补零(date.getMonth() + 1)}-${补零(date.getDate())} ${补零(date.getHours())}:${补零(date.getMinutes())}:${补零(date.getSeconds())}`;
  }
  return String(value).trim();
}

function 格式化金额(value) {
  // 解决：发票金额统一保留两位小数，避免前端展示时再猜格式。
  if (value === null || value === undefined || value === '') return '';
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value).trim();
  return `￥${numberValue.toFixed(2)}`;
}

function 归类发票状态(状态文本) {
  // 解决：后台卡片颜色只依赖稳定分类，不直接绑死京东状态文案。
  const 文本 = String(状态文本 || '').trim();
  if (!文本) return 'unknown';
  if (/成功/.test(文本)) return 'success';
  if (/待开票|开票中|待审核/.test(文本)) return 'pending';
  if (/失败|驳回/.test(文本)) return 'failed';
  if (/关闭|取消/.test(文本)) return 'closed';
  return 'unknown';
}

function 读取订单号(row, rowIndex) {
  // 解决：订单号是本地追踪主键，接口缺失时必须立刻失败。
  const orderNumber = String(row?.orderId || '').trim();
  if (!orderNumber) {
    throw new Error(`京东接口第 ${rowIndex + 1} 条订单缺少 orderId。`);
  }
  return orderNumber;
}

function 读取催促标记(row, rowIndex) {
  // 解决：只允许 ckFlag 布尔值决定是否登记，字段缺失不能退回猜测。
  if (typeof row?.ckFlag !== 'boolean') {
    throw new Error(`京东接口第 ${rowIndex + 1} 条订单缺少布尔字段 ckFlag，禁止登记。`);
  }
  return row.ckFlag;
}

function 读取发票状态文本(row) {
  // 解决：京东不同状态字段可能并存，按最接近页面文案的字段取值。
  return String(
    row?.invoiceStatusName
    || row?.invoiceSubStatusName
    || row?.auditInvoiceStatusName
    || row?.invoiceStatusDesc
    || row?.invoiceStatus
    || '',
  ).trim();
}

function 读取发票类型文本(row) {
  // 解决：发票类型只从接口类型字段取，不再从整行文本里猜。
  return String(row?.invoiceTypeName || row?.invoiceTypeDesc || row?.invoiceType || '').trim();
}

function 读取申请来源文本(row) {
  // 解决：申请来源单独映射，方便后续排查订单从哪里发起。
  return String(row?.sourceName || row?.sourceDesc || row?.sourceId || '').trim();
}

function 读取倒计时文本(row) {
  // 解决：倒计时字段可能是文案或状态，优先保留京东返回的文案。
  return String(row?.countDownTypeDesc || row?.countdownText || row?.invoiceDelayStatusName || '').trim();
}

function 构建后台摘要(record, hasUrge) {
  // 解决：本地记录只保存排查必要摘要，避免把手机号、地址等敏感字段塞进 rowText。
  return [
    `订单=${record.orderNumber}`,
    `催促开票=${hasUrge ? '是' : '否'}`,
    record.invoiceApplicationTime ? `申请时间=${record.invoiceApplicationTime}` : '',
    record.orderCompletionTime ? `订单完成=${record.orderCompletionTime}` : '',
    record.invoiceStatusText ? `状态=${record.invoiceStatusText}` : '',
    record.invoiceAmountText ? `金额=${record.invoiceAmountText}` : '',
  ].filter(Boolean).join('；');
}

function 构建发票订单记录(row, rowIndex = 0) {
  // 解决：把京东接口一条订单转换成本地长期展示和同步使用的稳定字段。
  const orderNumber = 读取订单号(row, rowIndex);
  const hasUrge = 读取催促标记(row, rowIndex);
  const invoiceStatusText = 读取发票状态文本(row);
  const record = {
    orderNumber,
    hasInvoiceUrge: hasUrge,
    invoiceApplicationTime: 格式化接口时间(row?.applyTime),
    orderCompletionTime: 格式化接口时间(row?.orderCompleteTime),
    invoiceCountdownText: 读取倒计时文本(row),
    invoiceTypeText: 读取发票类型文本(row),
    invoiceAmountText: 格式化金额(row?.invoiceAmount),
    invoiceTitle: String(row?.invoiceTitle || ''),
    invoiceSource: 读取申请来源文本(row),
    invoiceStatusText,
    invoiceStatusKind: 归类发票状态(invoiceStatusText),
  };
  return {
    ...record,
    summary: hasUrge ? `订单 ${orderNumber} 标记了催促开票` : `订单 ${orderNumber} 未标记催促开票`,
    source: hasUrge ? '京东接口催促标记 ckFlag' : '京东接口发票订单',
    rowText: 构建后台摘要(record, hasUrge),
    invoiceBackendRowText: 构建后台摘要(record, hasUrge),
  };
}

function 去重发票订单记录(记录列表) {
  // 解决：接口分页偶发重复时按订单号只保留最后一次结果。
  const 映射 = new Map();
  for (const 记录 of 记录列表 || []) {
    if (!记录?.orderNumber) continue;
    映射.set(记录.orderNumber, 记录);
  }
  return Array.from(映射.values());
}

function 构建发票订单列表(rows = []) {
  // 解决：接口原始行统一先转成结构化发票订单，再进入后续登记逻辑。
  return 去重发票订单记录(rows.map((row, index) => 构建发票订单记录(row, index)));
}

function 筛选催促订单(invoiceOrders = []) {
  // 解决：只登记客户点过催促开票的订单，ckFlag=false 永远不能进入待处理。
  return invoiceOrders.filter((record) => record.hasInvoiceUrge === true)
    .map((record) => ({
      ...record,
      source: '京东接口催促标记 ckFlag',
      summary: `订单 ${record.orderNumber} 标记了催促开票`,
    }));
}

function 统计发票状态(记录列表) {
  // 解决：扫描结果指标按同一状态分类汇总。
  return (记录列表 || []).reduce((统计, 记录) => {
    const 状态 = 记录.invoiceStatusKind || 'unknown';
    统计[状态] = (统计[状态] || 0) + 1;
    return 统计;
  }, {});
}

module.exports = {
  格式化接口时间,
  归类发票状态,
  构建发票订单记录,
  构建发票订单列表,
  筛选催促订单,
  统计发票状态,
};
