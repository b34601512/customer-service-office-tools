# 该文件用于处理订单人工处理、处理中和备注动作。
from __future__ import annotations

from typing import Any

from ..handled_orders import HandledOrderRecord
from ..order_detector import ProblemOrder
from ..order_presenter import order_to_dict, stored_record_to_dict


class OrderActionsMixin:
    def mark_order_handled(self, key: str) -> dict[str, Any]:
        # 该函数用于把当前待处理订单人工标记为已处理，后续扫描不再提醒但仍保留展示。
        return self.set_order_handled(key, handled=True)

    def set_order_handled(self, key: str, *, handled: bool) -> dict[str, Any]:
        # 该函数用于统一处理勾选和反选，让订单在未处理/已处理两列之间切换。
        text_key = str(key or "").strip()
        if not text_key:
            raise RuntimeError("更新处理状态失败：订单 key 不能为空")
        with self._lock:
            order = next((item for item in self.last_problem_orders if item.key == text_key), None)
            record = self._set_order_record_status(text_key, handled=handled, order=order)
            remaining = self._pending_runtime_order_count()
            order_data = order_to_dict(order, handled=record.handled, handled_record=record) if order else stored_record_to_dict(record)
        if handled:
            self._append_log(f"已人工标记处理：{record.summary}。该订单会保留为绿色已处理状态，后续扫描不再提醒。")
        else:
            self._append_log(f"已取消人工处理：{record.summary}。该订单已恢复到未处理列表。")
        if remaining:
            self._set_indicator("alert", "warning", f"当前仍有 {remaining} 个订单需要处理。")
        else:
            self._set_indicator("alert", "ok", "当前待处理订单已全部人工处理。")
        return order_data

    def set_order_verifying(self, key: str, *, verifying: bool) -> dict[str, Any]:
        # 该函数用于切换订单“正在核实”状态，把刚开始看的订单放到独立列里。
        text_key = str(key or "").strip()
        if not text_key:
            raise RuntimeError("更新正在核实状态失败：订单 key 不能为空")
        with self._lock:
            order = next((item for item in self.last_problem_orders if item.key == text_key), None)
            self._ensure_order_record(text_key, order)
            record = self.handled_orders.set_verifying(text_key, verifying)
            order_data = order_to_dict(order, handled=record.handled, handled_record=record) if order else stored_record_to_dict(record)
        message = "已开始核实" if verifying else "已取消核实"
        self._append_log(f"{message}：{record.summary}。")
        return order_data

    def set_order_processing(self, key: str, *, processing: bool) -> dict[str, Any]:
        # 该函数用于切换订单“处理中”状态，但订单仍保留在未处理列表继续追踪。
        text_key = str(key or "").strip()
        if not text_key:
            raise RuntimeError("更新处理中状态失败：订单 key 不能为空")
        with self._lock:
            order = next((item for item in self.last_problem_orders if item.key == text_key), None)
            self._ensure_order_record(text_key, order)
            record = self.handled_orders.set_processing(text_key, processing)
            order_data = order_to_dict(order, handled=record.handled, handled_record=record) if order else stored_record_to_dict(record)
        message = "已标记处理中" if processing else "已取消处理中"
        self._append_log(f"{message}：{record.summary}。")
        return order_data

    def set_order_note(self, key: str, *, note_text: str) -> dict[str, Any]:
        # 该函数用于保存订单备注并返回最新订单卡片数据。
        text_key = str(key or "").strip()
        if not text_key:
            raise RuntimeError("保存订单备注失败：订单 key 不能为空")
        with self._lock:
            order = next((item for item in self.last_problem_orders if item.key == text_key), None)
            self._ensure_order_record(text_key, order)
            record = self.handled_orders.set_note(text_key, note_text)
            order_data = order_to_dict(order, handled=record.handled, handled_record=record) if order else stored_record_to_dict(record)
        action = "已保存备注" if record.note_text else "已清空备注"
        self._append_log(f"{action}：{record.summary}。")
        return order_data

    def _set_order_record_status(self, key: str, *, handled: bool, order: ProblemOrder | None) -> HandledOrderRecord:
        # 该函数用于在“实时扫描订单”和“本地快照订单”之间复用同一套状态更新规则。
        if handled and order is not None:
            order_data = order_to_dict(order)
            return self.handled_orders.mark_order(
                order,
                order_number=order_data.get("orderNumber", ""),
                platform_order_number=order_data.get("platformOrderNumber", ""),
                shop_name=order_data.get("shopName", ""),
                order_source_text=order_data.get("orderSourceText", ""),
                allocation_status_text=order_data.get("allocationStatusText", ""),
                shipping_status_text=order_data.get("shippingStatusText", ""),
                audit_status_text=order_data.get("auditStatusText", ""),
                payment_time_text=order_data.get("paymentTimeText", ""),
                refund_status_text=order_data.get("refundStatusText", ""),
                seller_remark_text=order_data.get("sellerRemarkText", ""),
            )
        record = self.handled_orders.get(key)
        if record is None:
            raise RuntimeError("更新处理状态失败：当前订单列表和本地记录里都找不到该订单，请先重新扫描。")
        return self.handled_orders.set_handled(key, handled)

    def _ensure_order_record(self, key: str, order: ProblemOrder | None) -> HandledOrderRecord:
        # 该函数用于在前端操作订单前确保本地有可更新的订单快照。
        record = self.handled_orders.get(key)
        if record is not None:
            return record
        if order is None:
            raise RuntimeError("更新订单状态失败：当前订单列表和本地记录里都找不到该订单，请先重新扫描。")
        order_data = order_to_dict(order)
        return self.handled_orders.remember_order(
            order,
            order_number=order_data.get("orderNumber", ""),
            platform_order_number=order_data.get("platformOrderNumber", ""),
            shop_name=order_data.get("shopName", ""),
            order_source_text=order_data.get("orderSourceText", ""),
            allocation_status_text=order_data.get("allocationStatusText", ""),
            shipping_status_text=order_data.get("shippingStatusText", ""),
            audit_status_text=order_data.get("auditStatusText", ""),
            payment_time_text=order_data.get("paymentTimeText", ""),
            refund_status_text=order_data.get("refundStatusText", ""),
            seller_remark_text=order_data.get("sellerRemarkText", ""),
        )


__all__ = ["OrderActionsMixin"]
