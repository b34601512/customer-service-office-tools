// 24号「货物安全复查」的判定核心：只做结构判定，不读撕单状态等自由文本（那些交模型语义判断）。
// 口径来源：用户 2026-09-27。
//
// 判定顺序：
//   ① ERP 无此单           → 待人工核-ERP无此单
//   ② ERP cancel=true      → 安全-ERP已作废（不会发货）
//   ③ ERP deliveryState>0  → 已发货：退货表搜到=安全；搜不到=风险（货发出且没退回）
//   ④ 未发货但《撕单表》有记录 → 待读撕单状态（状态原文交模型读）
//   ⑤ 未发货、撕单表没有、approve=true → 风险-已审单未撕单（可能还会发）
//   ⑥ 其余                → 观察-未发货未审核
function classifyOrder({ erp, torn, returned }) {
  if (!erp) return "待人工核-ERP无此单";
  if (erp.cancel) return "安全-ERP已作废";
  if (Number(erp.deliveryState) > 0) {
    return returned ? "安全-已登记退货" : "风险-已发货未登记退货";
  }
  if (Array.isArray(torn) && torn.length) return "待读撕单状态";
  if (erp.approve) return "风险-已审单未撕单";
  return "观察-未发货未审核";
}

module.exports = { classifyOrder };
