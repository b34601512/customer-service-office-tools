# 该文件用于生成 ERP 浏览器脚本所需配置。
from __future__ import annotations

from typing import Any

from ..config import AppConfig


def order_row_scan_config(config: AppConfig) -> dict[str, Any]:
    # 该函数用于生成订单主表可见行扫描参数。
    return {
        "order_row_column_names": _order_row_column_names(config),
        "order_grid_marker_column_names": _order_grid_marker_column_names(),
    }


def _order_row_column_names(config: AppConfig) -> list[str]:
    # 该函数用于统一订单行身份列，避免不同扫描动作字段不一致。
    return list(
        dict.fromkeys(
            [
                *config.detection.identity_column_names,
                "平台单号",
                "订单编号",
                "支付日期",
                "单据时间",
                "店铺名称",
                "会员名称",
            ]
        )
    )


def _order_grid_marker_column_names() -> list[str]:
    # 该函数列出即使订单编号列暂时不可见，也能证明当前是订单主表的稳定业务列。
    return ["退款", "作废", "卖家备注", "建议快递", "建议仓库", "配货状态", "发货状态", "审核", "订单来源", "订单打印"]


__all__ = ["order_row_scan_config"]
