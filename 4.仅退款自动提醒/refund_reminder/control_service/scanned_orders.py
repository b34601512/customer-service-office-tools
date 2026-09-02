# 该文件用于处理扫描订单与本地人工状态的合并和过滤。
from __future__ import annotations

from typing import Any

from ..order_detector import ProblemOrder
from ..payment_time_range import filter_orders_by_payment_time_range
from ..order_presenter import order_to_dict, stored_record_to_dict


class ScannedOrdersMixin:
    def _filter_unhandled_orders(self, orders: tuple[ProblemOrder, ...]) -> tuple[tuple[ProblemOrder, ...], int]:
        # 该函数用于过滤人工已处理订单，让同一订单不会反复提醒。
        active_orders: list[ProblemOrder] = []
        handled_orders: list[ProblemOrder] = []
        for order in orders:
            if self.handled_orders.is_handled(order.key):
                handled_orders.append(order)
            else:
                active_orders.append(order)
        signature = ",".join(sorted(item.key for item in handled_orders))
        if signature and signature != self._last_handled_filter_signature:
            labels = "、".join(item.summary for item in handled_orders[:8])
            extra = f"，另有 {len(handled_orders) - 8} 个未展开" if len(handled_orders) > 8 else ""
            self._append_log(f"已处理订单不再提醒但保留展示：{labels}{extra}。")
        self._last_handled_filter_signature = signature
        return tuple(active_orders), len(handled_orders)

    def _pending_record_keys(self) -> set[str]:
        # 该函数用于识别扫描前已经在未处理列表里的订单，避免第二轮重复弹窗。
        return {record.key for record in self.handled_orders.records() if not record.handled}

    @staticmethod
    def _filter_new_unhandled_orders(orders: tuple[ProblemOrder, ...], existing_pending_keys: set[str]) -> tuple[ProblemOrder, ...]:
        # 该函数只保留本轮新进入未处理列表的订单，旧未处理订单继续展示但不再提醒。
        return tuple(order for order in orders if order.key not in existing_pending_keys)

    def _filter_notification_payment_time_orders(self, orders: tuple[ProblemOrder, ...]) -> tuple[ProblemOrder, ...]:
        # 该函数按通知付款范围过滤新增订单，不改变后台待处理订单池。
        days = int(self.config.notification.payment_time_range_days)
        return filter_orders_by_payment_time_range(orders, days)

    def _set_new_order_alert_indicator(self, pending_count: int, new_orders: tuple[ProblemOrder, ...], notification_orders: tuple[ProblemOrder, ...]) -> None:
        # 该函数用于区分“仍待处理”“新增但超出付款范围”和“本轮需要系统通知”。
        skipped_count = max(0, len(new_orders) - len(notification_orders))
        days = int(self.config.notification.payment_time_range_days)
        if notification_orders:
            extra = f"，另有 {skipped_count} 个超出通知付款范围未弹窗" if skipped_count else ""
            self._set_indicator("alert", "warning", f"当前仍有 {pending_count} 个订单需要处理，新增 {len(notification_orders)} 个符合最近 {days} 天付款范围，本次只提醒这些订单{extra}。")
            return
        if new_orders:
            self._set_indicator("alert", "ok", f"当前仍有 {pending_count} 个订单需要处理，新增 {len(new_orders)} 个订单均超出最近 {days} 天付款范围，不发系统通知。")
            self._append_log(f"新增 {len(new_orders)} 个订单超出通知付款范围：最近 {days} 天付款才弹窗；订单仍保留在后台列表。")
            return
        self._set_indicator("alert", "ok", f"当前仍有 {pending_count} 个订单需要处理，本次没有新增订单，不发系统通知。")
        self._append_log(f"当前仍有 {pending_count} 个订单需要处理；本次没有新增订单，不发系统通知。")

    def _remember_scanned_problem_orders(self, orders: tuple[ProblemOrder, ...]) -> None:
        # 该函数用于把本次扫描到的未处理/已处理订单快照写入本地，供下次启动直接恢复。
        for order in orders:
            self._remember_single_scanned_problem_order(order)

    def _remember_single_scanned_problem_order(self, order: ProblemOrder) -> None:
        # 该函数用于把一个刚命中的订单快照立即落盘，避免等待整轮扫描结束。
        order_data = order_to_dict(order)
        self.handled_orders.remember_order(
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

    def _record_incremental_scanned_problem_order(self, order: ProblemOrder) -> None:
        # 该函数用于把扫描中刚确认的订单实时写入前端快照和本地记录。
        self._remember_single_scanned_problem_order(order)
        text_key = str(order.key or "").strip()
        if not text_key:
            raise RuntimeError("实时添加扫描订单失败：订单缺少唯一 key")
        with self._lock:
            existing_keys = {item.key for item in self.last_problem_orders}
            if text_key in existing_keys:
                self.last_problem_orders = tuple(order if item.key == text_key else item for item in self.last_problem_orders)
                added_to_runtime = False
            else:
                self.last_problem_orders = (*self.last_problem_orders, order)
                added_to_runtime = True
            pending_count = self._pending_runtime_order_count()
        if added_to_runtime:
            self._set_indicator("scan", "running", f"已实时添加待提醒订单：{order.summary}，当前待处理 {pending_count} 个。")
            self._append_log(f"已实时添加待提醒订单：{order.summary}。")

    def _build_runtime_order_dicts(self, orders: tuple[ProblemOrder, ...]) -> list[dict[str, Any]]:
        # 该函数用于把实时扫描订单和本地处理状态快照合并给前端双列展示。
        records = self.handled_orders.records()
        record_by_key = {record.key: record for record in records}
        current_keys = {order.key for order in orders}
        items: list[dict[str, Any]] = []
        for order in orders:
            item = order_to_dict(
                order,
                handled=bool(record_by_key.get(order.key) and record_by_key[order.key].handled),
                handled_record=record_by_key.get(order.key),
            )
            if item.get("platformOrderNumber"):
                items.append(item)
        for record in records:
            if record.key in current_keys:
                continue
            item = stored_record_to_dict(record)
            if item.get("platformOrderNumber"):
                items.append(item)
        return items

    def _pending_runtime_order_count(self) -> int:
        # 该函数用于统计前端未处理列数量，确保反选本地记录后状态提示不自相矛盾。
        return sum(1 for item in self._build_runtime_order_dicts(self.last_problem_orders) if not item.get("handled"))


__all__ = ["ScannedOrdersMixin"]
