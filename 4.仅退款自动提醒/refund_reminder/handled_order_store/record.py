# 该文件用于定义订单状态记录的数据结构。
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HandledOrderRecord:
    key: str
    handled: bool
    verifying: bool
    processing: bool
    added_at: float
    marked_at: float
    updated_at: float
    summary: str
    order_number: str
    platform_order_number: str
    shop_name: str
    order_source_text: str
    allocation_status_text: str
    shipping_status_text: str
    audit_status_text: str
    payment_time_text: str
    refund_status_text: str
    seller_remark_text: str
    note_text: str
    row_label: str
    identity: str


__all__ = ["HandledOrderRecord"]
