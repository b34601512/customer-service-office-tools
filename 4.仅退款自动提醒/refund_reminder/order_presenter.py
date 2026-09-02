#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import time
from typing import Any

from .handled_orders import HandledOrderRecord
from .order_detector import (
    PAYMENT_TIME_COLUMN_NAMES,
    PLATFORM_ORDER_COLUMN_NAMES,
    ProblemOrder,
    REFUND_EVIDENCE_COLUMN_NAMES,
    is_valid_platform_order_text,
    normalize_header,
)

# 展示层列名清单统一引用 order_detector 单一真源（#593），旧名保留为别名供外部导入兼容。
PAYMENT_TIME_FIELD_NAMES = PAYMENT_TIME_COLUMN_NAMES
REFUND_STATUS_FIELD_NAMES = REFUND_EVIDENCE_COLUMN_NAMES
SELLER_REMARK_FIELD_NAMES = ("卖家备注", "卖家留言", "卖家订单备注", "客服备注")
ORDER_SOURCE_FIELD_NAMES = ("订单来源", "来源", "来源平台")
ALLOCATION_STATUS_FIELD_NAMES = ("配货状态", "配货")
SHIPPING_STATUS_FIELD_NAMES = ("发货状态", "发货")
AUDIT_STATUS_FIELD_NAMES = ("审核状态", "审核")


def format_datetime(timestamp: float | None) -> str:
    # 该函数用于展示持久已处理记录的落盘时间，便于重启后核对来源。
    if not timestamp:
        return ""
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(timestamp))


def pick_row_value(row: dict[str, str], names: tuple[str, ...]) -> str:
    # 该函数用于从 ERP 行数据里按多个可能列名提取订单展示字段。
    normalized_row = {normalize_header(key): value for key, value in row.items()}
    normalized_names = tuple(normalize_header(item) for item in names)
    for name in normalized_names:
        value = normalized_row.get(name, "")
        if value:
            return value
    for key, value in normalized_row.items():
        if value and any(name and name in key for name in normalized_names):
            return value
    return ""


def extract_payment_time_text(order: ProblemOrder) -> str:
    # 该函数用于统一提取支付日期，前端会按这个字段做 1/2/3/5/7 天分类显示。
    return order.payment_time_text or pick_row_value(order.row, PAYMENT_TIME_FIELD_NAMES)


def extract_refund_status_text(order: ProblemOrder) -> str:
    # 该函数用于展示导出表里的退款证据，方便确认当前页面确实是退款筛选结果。
    return order.refund_status_text or pick_row_value(order.row, REFUND_STATUS_FIELD_NAMES)


def extract_seller_remark_text(order: ProblemOrder) -> str:
    # 该函数用于展示 ERP 卖家备注，客服已处理过的订单可以直接从卡片上识别。
    return pick_row_value(order.row, SELLER_REMARK_FIELD_NAMES)


def order_to_dict(order: ProblemOrder, *, handled: bool = False, handled_record: HandledOrderRecord | None = None) -> dict[str, Any]:
    # 该函数用于把实时扫描订单转换成前端可展示的订单卡片。
    row_index = order.row_index + 1
    platform_order_number = pick_row_value(order.row, PLATFORM_ORDER_COLUMN_NAMES)
    if platform_order_number and not is_valid_platform_order_text(platform_order_number):
        platform_order_number = ""
    erp_order_number = pick_row_value(order.row, ("订单编号", "订单号"))
    return {
        "key": order.key,
        "rowIndex": row_index,
        "rowLabel": f"第{row_index}行",
        "identity": order.identity,
        "orderNumber": erp_order_number,
        "platformOrderNumber": platform_order_number,
        "copyOrderNumber": platform_order_number,
        "shopName": pick_row_value(order.row, ("店铺名称", "店铺")),
        "orderSourceText": pick_row_value(order.row, ORDER_SOURCE_FIELD_NAMES),
        "allocationStatusText": pick_row_value(order.row, ALLOCATION_STATUS_FIELD_NAMES),
        "shippingStatusText": pick_row_value(order.row, SHIPPING_STATUS_FIELD_NAMES),
        "auditStatusText": pick_row_value(order.row, AUDIT_STATUS_FIELD_NAMES),
        "paymentTimeText": extract_payment_time_text(order),
        "refundStatusText": extract_refund_status_text(order),
        "sellerRemarkText": extract_seller_remark_text(order),
        "summary": order.summary,
        "handled": bool(handled),
        "verifying": bool(handled_record.verifying) if handled_record else False,
        "processing": bool(handled_record.processing) if handled_record else False,
        "noteText": handled_record.note_text if handled_record else "",
        "source": "scan",
        "addedAt": handled_record.added_at if handled_record else None,
        "addedAtText": format_datetime(handled_record.added_at) if handled_record else "",
        "markedAt": handled_record.marked_at if handled and handled_record else None,
        "markedAtText": format_datetime(handled_record.marked_at) if handled and handled_record else "",
    }


def stored_record_to_dict(record: HandledOrderRecord) -> dict[str, Any]:
    # 该函数用于把本地订单状态记录转换成前端可展示的订单卡片。
    return {
        "key": record.key,
        "rowIndex": None,
        "rowLabel": record.row_label or ("已处理记录" if record.handled else "未处理记录"),
        "identity": record.identity,
        "orderNumber": record.order_number,
        "platformOrderNumber": record.platform_order_number,
        "copyOrderNumber": record.platform_order_number,
        "shopName": record.shop_name,
        "orderSourceText": record.order_source_text,
        "allocationStatusText": record.allocation_status_text,
        "shippingStatusText": record.shipping_status_text,
        "auditStatusText": record.audit_status_text,
        "paymentTimeText": record.payment_time_text,
        "refundStatusText": record.refund_status_text,
        "sellerRemarkText": record.seller_remark_text,
        "summary": record.summary,
        "handled": record.handled,
        "verifying": record.verifying,
        "processing": record.processing,
        "noteText": record.note_text,
        "source": "stored",
        "addedAt": record.added_at,
        "addedAtText": format_datetime(record.added_at),
        "markedAt": record.marked_at if record.handled else None,
        "markedAtText": format_datetime(record.marked_at) if record.handled else "",
    }


__all__ = ["extract_payment_time_text", "extract_refund_status_text", "extract_seller_remark_text", "order_to_dict", "pick_row_value", "stored_record_to_dict"]
