// 该文件用于解决五个平台共用一套人工订单阶段、合法转换、统计、筛选和搜索规则的问题。

const 工作流状态 = Object.freeze({
  待处理: 'pending',
  处理中: 'processing',
  发票已登记: 'invoice_registered',
  已处理: 'handled',
});

const 工作流状态列表 = Object.freeze(Object.values(工作流状态));
const 工作流状态中文 = Object.freeze({
  [工作流状态.待处理]: '待处理',
  [工作流状态.处理中]: '处理中',
  [工作流状态.发票已登记]: '发票已登记',
  [工作流状态.已处理]: '已处理',
});
const 旧状态映射 = Object.freeze({
  pending: 工作流状态.待处理,
  processing: 工作流状态.处理中,
  invoiceRegistered: 工作流状态.发票已登记,
  invoice_registered: 工作流状态.发票已登记,
  handled: 工作流状态.已处理,
});
const 合法转换 = Object.freeze({
  [工作流状态.待处理]: Object.freeze([工作流状态.处理中]),
  [工作流状态.处理中]: Object.freeze([
    工作流状态.待处理,
    工作流状态.发票已登记,
    工作流状态.已处理,
  ]),
  [工作流状态.发票已登记]: Object.freeze([
    工作流状态.处理中,
    工作流状态.已处理,
  ]),
  [工作流状态.已处理]: Object.freeze([工作流状态.发票已登记]),
});

function 规范化工作流状态(status, 默认状态 = '') {
  const 原始状态 = String(status || '').trim();
  const 标准状态 = 旧状态映射[原始状态] || 原始状态;
  if (工作流状态列表.includes(标准状态)) return 标准状态;
  if (!原始状态 && 默认状态) return 规范化工作流状态(默认状态);
  throw new Error(`订单人工阶段无效：${原始状态 || '空值'}。`);
}

function 从旧记录推断工作流状态(record = {}) {
  if (record.workflowStatus !== undefined && String(record.workflowStatus).trim()) {
    return 规范化工作流状态(record.workflowStatus);
  }
  if (record.handled === true) return 工作流状态.已处理;
  if (record.invoiceRegistered === true) return 工作流状态.发票已登记;
  if (record.processing === true) return 工作流状态.处理中;
  const 旧单值状态 = String(record.status || record.followupStatus || '').trim();
  return 旧单值状态 ? 规范化工作流状态(旧单值状态) : 工作流状态.待处理;
}

function 读取工作流状态(order = {}) {
  return 规范化工作流状态(order.workflowStatus, 工作流状态.待处理);
}

function 读取本地处理阶段(order = {}) {
  return 工作流状态中文[读取工作流状态(order)];
}

function 获取允许转换状态(currentStatus) {
  return [...合法转换[规范化工作流状态(currentStatus)] || []];
}

function 校验工作流转换(currentStatus, targetStatus) {
  const 当前状态 = 规范化工作流状态(currentStatus);
  const 目标状态 = 规范化工作流状态(targetStatus);
  if (!合法转换[当前状态].includes(目标状态)) {
    throw new Error(`订单状态不能从“${工作流状态中文[当前状态]}”直接改为“${工作流状态中文[目标状态]}”。`);
  }
  return 目标状态;
}

function 转换订单工作流状态(order, targetStatus, now = new Date().toISOString()) {
  const 当前状态 = 读取工作流状态(order);
  const 目标状态 = 校验工作流转换(当前状态, targetStatus);
  const next = {
    ...order,
    workflowStatus: 目标状态,
    updatedAt: now,
  };
  if (目标状态 === 工作流状态.处理中) {
    next.processingAt = next.processingAt || now;
    next.invoiceRegisteredAt = '';
    next.handledAt = '';
  } else if (目标状态 === 工作流状态.发票已登记) {
    next.processingAt = next.processingAt || now;
    next.invoiceRegisteredAt = next.invoiceRegisteredAt || now;
    next.handledAt = '';
  } else if (目标状态 === 工作流状态.已处理) {
    next.processingAt = next.processingAt || now;
    next.invoiceRegisteredAt = next.invoiceRegisteredAt || now;
    next.handledAt = now;
  } else {
    next.processingAt = '';
    next.invoiceRegisteredAt = '';
    next.handledAt = '';
  }
  return next;
}

function 获取订单统计(orderList = []) {
  const list = Array.isArray(orderList) ? orderList : [];
  const counts = {
    total: list.length,
    pending: 0,
    processing: 0,
    invoiceRegistered: 0,
    invoice_registered: 0,
    handled: 0,
  };
  for (const order of list) {
    const status = 读取工作流状态(order);
    if (status === 工作流状态.待处理) counts.pending += 1;
    if (status === 工作流状态.处理中) counts.processing += 1;
    if (status === 工作流状态.发票已登记) {
      counts.invoiceRegistered += 1;
      counts.invoice_registered += 1;
    }
    if (status === 工作流状态.已处理) counts.handled += 1;
  }
  return counts;
}

function 规范化筛选状态(filterStatus) {
  const raw = String(filterStatus || '').trim();
  if (raw === 'all') return 'all';
  return 规范化工作流状态(raw || 工作流状态.待处理);
}

function 筛选订单(orderList = [], filterStatus = 工作流状态.待处理) {
  const list = Array.isArray(orderList) ? orderList : [];
  const status = 规范化筛选状态(filterStatus);
  return status === 'all' ? [...list] : list.filter((order) => 读取工作流状态(order) === status);
}

function 读取平台状态(order = {}) {
  const platformStatus = order.platformStatus;
  if (platformStatus && typeof platformStatus === 'object' && !Array.isArray(platformStatus)) {
    return {
      kind: String(platformStatus.kind || platformStatus.code || 'unknown').trim() || 'unknown',
      text: String(platformStatus.text || platformStatus.label || '未同步').trim() || '未同步',
    };
  }
  return {
    kind: String(order.invoiceStatusKind || order.orderStatus || order.invoiceStatus || 'unknown').trim() || 'unknown',
    text: String(order.invoiceStatusText || order.orderStatus || order.invoiceStatus || '未同步').trim() || '未同步',
  };
}

function 读取后台开票状态(order = {}) {
  return 读取平台状态(order);
}

function 订单匹配搜索(order = {}, searchText = '') {
  const keyword = String(searchText || '').trim().toLowerCase();
  if (!keyword) return true;
  const platformStatus = 读取平台状态(order);
  return [
    order.key,
    order.storeId,
    order.storeName,
    order.orderNumber,
    order.assigneeName,
    order.contactName,
    order.noteText,
    order.orderNoteText,
    order.summary,
    order.rowText,
    order.invoiceTitle,
    order.invoiceAmountText,
    order.invoiceAmount,
    order.invoiceCountdownText,
    platformStatus.kind,
    platformStatus.text,
  ].some((value) => String(value || '').toLowerCase().includes(keyword));
}

function 是待回传订单(order = {}, 选项 = {}) {
  // 解决：京东依赖“发票已登记”人工阶段才允许正式回传；天猫、拼多多、抖音没有登记动作，
  // 直接从后台待回传列表同步订单，回传时不应要求发票已登记。
  const { 要求已登记 = true } = 选项;
  if (要求已登记 && 读取工作流状态(order) !== 工作流状态.发票已登记) {
    return false;
  }
  return String(order.lastReturnAttempt?.status || '').trim() !== 'success'
    && order.invoiceReturned !== true;
}

function 是发票已登记待回传订单(order = {}) {
  return 是待回传订单(order, { 要求已登记: true });
}

function 是平台待开票待回传订单(order = {}) {
  // 解决：回传口径改为看平台“开票状态=待开票”，不再要求本地人工登记“发票已登记”；
  // 未回传成功且未标记回传完成的待开票订单才进入回传。
  return 读取平台状态(order).kind === 'pending'
    && 是待回传订单(order, { 要求已登记: false });
}

module.exports = {
  工作流状态,
  工作流状态列表,
  工作流状态中文,
  合法转换,
  规范化工作流状态,
  从旧记录推断工作流状态,
  读取工作流状态,
  读取本地处理阶段,
  获取允许转换状态,
  校验工作流转换,
  转换订单工作流状态,
  获取订单统计,
  规范化筛选状态,
  筛选订单,
  读取平台状态,
  读取后台开票状态,
  订单匹配搜索,
  是待回传订单,
  是发票已登记待回传订单,
  是平台待开票待回传订单,
};
