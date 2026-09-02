# 该文件用于保存可见订单行扫描脚本的入口配置片段。
from __future__ import annotations

VISIBLE_ORDER_ROWS_PROLOGUE = r"""
async (config) => {
  const orderNames = (config.order_row_column_names || ["平台单号", "订单编号", "支付日期", "单据时间", "店铺名称"]).map(normalizeHeader);
  const orderGridMarkerNames = (config.order_grid_marker_column_names || ["退款", "作废", "卖家备注", "建议快递", "建议仓库", "配货状态", "订单打印"]).map(normalizeHeader);

"""

__all__ = ["VISIBLE_ORDER_ROWS_PROLOGUE"]

