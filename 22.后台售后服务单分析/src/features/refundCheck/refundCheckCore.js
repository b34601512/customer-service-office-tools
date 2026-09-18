// 反向检查核心：从金山「退货退款表」的记录里挑出「客户已寄回、应退金额仍未退款」的单。
// 口径（用户 2026-09-18 拍板）：登记日期在最近 N 天内 + 应退金额 > 0 + 退款状态不含「已退款」。
// 数据坑都在这一个文件里收口：日期列有两种形态（文本 / Excel 序列号）、同订单重复登记、客户字段含换行。
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

// 日期列：早期是 "2025/1/8" 这类文本，近期是 Excel 序列号（如 46247）。两种都要认。
function parseRecordDate(value) {
  const text = toText(value);
  if (!text) return null;
  if (/^\d{4,6}(\.0)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 30000 && serial < 60000) return new Date(EXCEL_EPOCH_UTC + serial * MS_PER_DAY);
    return null;
  }
  let matched = text.match(/^(\d{4})[/年-](\d{1,2})[/月-](\d{1,2})/);
  if (matched) return new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])));
  matched = text.match(/^(\d{4})[/年-](\d{1,2})/);
  if (matched) return new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, 1));
  return null;
}

function parseMoney(value) {
  const matched = toText(value).replace(/,/g, "").match(/^(\d+(\.\d+)?)$/);
  return matched ? Number(matched[1]) : 0;
}

function isRefunded(statusText) {
  return toText(statusText).includes("已退款");
}

// samples 来自 kdocs-filter（AirScript 只读筛选）的返回
function selectPendingRefunds(samples, options = {}) {
  const days = Number(options.days === undefined ? 7 : options.days);
  const today = options.today instanceof Date ? options.today : new Date();
  const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - days * MS_PER_DAY);
  const seen = new Set();
  const picked = [];
  const skipped = { noOrderId: 0, duplicated: 0, tooOld: 0, refunded: 0, noAmount: 0, badDate: 0 };
  for (const sample of samples || []) {
    const orderId = toText(sample.orderId);
    if (!orderId) { skipped.noOrderId += 1; continue; }
    if (seen.has(orderId)) { skipped.duplicated += 1; continue; }
    seen.add(orderId);
    const date = parseRecordDate(sample.date);
    if (!date) { skipped.badDate += 1; continue; }
    if (date.getTime() < cutoff.getTime()) { skipped.tooOld += 1; continue; }
    if (isRefunded(sample.status)) { skipped.refunded += 1; continue; }
    const refund = parseMoney(sample.shouldRefund);
    if (refund <= 0) { skipped.noAmount += 1; continue; }
    picked.push({
      date: date.toISOString().slice(0, 10),
      platform: toText(sample.platform),
      customer: toText(sample.customer).slice(0, 16),
      orderId,
      refund,
      tracking: toText(sample.returnTracking)
    });
  }
  picked.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
  return { days, cutoff: cutoff.toISOString().slice(0, 10), items: picked, skipped, totalAmount: picked.reduce((sum, item) => sum + item.refund, 0) };
}

function buildNoticeText(result, options = {}) {
  const atName = options.atName || "";
  const lines = [
    `【售后退款待处理】${atName ? `@${atName}` : ""}`.trim(),
    `近 ${result.days} 天登记的退货：客户已寄回、应退金额仍未退款，共 ${result.items.length} 单 ${Math.round(result.totalAmount).toLocaleString("en-US")} 元，请尽快处理：`,
    "（格式：登记日 平台 客户 订单号 应退金额）"
  ];
  result.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.date.slice(5)} ${item.platform} ${item.customer} ${item.orderId} 应退${Math.round(item.refund)}`);
  });
  lines.push("—— 明细见《2026年【湖南怀化售后】对接表》· 退货退款表");
  return lines.join("\n");
}

module.exports = { toText, parseRecordDate, parseMoney, isRefunded, selectPendingRefunds, buildNoticeText };
