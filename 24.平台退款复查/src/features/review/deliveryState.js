// 京东「仅退款」漏退回的最后一道筛：**货在路上没有**（用户 2026-09-27 口径）。
//
// 规则（用户原话：「如果还在路上这种不用管」）：
//   · 运输中 / 拒收 / 物流异常 / 已出库  → **在途，不用管**（等它到，届时会进京东仓或怀化表）
//   · 已签收                            → **真风险**：客户签收了又仅退款，货没退回来，必须追
//
// 为什么要有这一步（实测）：五店 440 单里 16 单三处（京东仓/怀化表/撕单表）都没命中，
//   一看物流状态：13 单还在途（6 运输中 / 5 物流异常 / 2 拒收）、只有 2 单已签收。
//   不做这一步就会把 13 单在途的当风险报出去 → 白折腾客服。
//
// 「已签收」字段来源：京东自主售后列表响应 `deliveryWareFacetDTO.deliveryWareStateName`
//   （同行的 `deliveryWareLogisticsFacetDTOList[].logisticsTrackFacetDTOList[]` 还带轨迹原文，
//    如「您的订单已到达京东【湛江赤坎站】」，需要时可以把轨迹原文一起给人看）。

const IN_TRANSIT_STATES = ["运输中", "拒收", "物流异常", "已出库"];
const SIGNED_STATES = ["已签收"];

function classifyDelivery(stateName) {
  const state = String(stateName || "").trim();
  if (!state) return { kind: "unknown", label: "物流状态未知", skip: false };
  if (SIGNED_STATES.includes(state)) return { kind: "signed", label: "已签收（货在客户手里）", skip: false };
  if (IN_TRANSIT_STATES.includes(state)) return { kind: "in_transit", label: "在途/退回中（不用管）", skip: true };
  return { kind: "unknown", label: `物流状态「${state}」待人工看`, skip: false };
}

module.exports = { classifyDelivery, IN_TRANSIT_STATES, SIGNED_STATES };
