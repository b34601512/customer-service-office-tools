# 该文件用于提供订单状态存储的稳定对外接口。
from __future__ import annotations

import time
from dataclasses import replace
from pathlib import Path
from threading import RLock

from ..order_detector import ProblemOrder, is_valid_platform_order_text
from .file_storage import load_order_records, save_order_records
from .record import HandledOrderRecord
from .retention import HandledOrderRetentionPolicy
from .text_cleaning import normalize_order_note_text


class HandledOrderStore:
    def __init__(
        self,
        path: Path,
        *,
        archive_root: Path | None = None,
        retention_policy: HandledOrderRetentionPolicy | None = None,
    ) -> None:
        # 该存储用于持久记录订单人工处理状态，并自动迁移过期已处理历史。
        self.path = Path(path)
        self.archive_root = Path(archive_root) if archive_root is not None else self.path.parent / "handled_orders_archive"
        self.retention_policy = retention_policy or HandledOrderRetentionPolicy()
        self._lock = RLock()
        self._records = load_order_records(self.path)
        self._save_records()

    def is_handled(self, key: str) -> bool:
        # 该函数用于判断订单 key 是否已经被人工处理。
        with self._lock:
            record = self._records.get(str(key or ""))
            return bool(record and record.handled)

    def count(self) -> int:
        # 该函数用于后台展示当前已处理订单数量。
        with self._lock:
            return sum(1 for record in self._records.values() if record.handled)

    def records(self) -> tuple[HandledOrderRecord, ...]:
        # 该函数用于向前端展示本地保存的当前有效订单状态快照。
        with self._lock:
            return tuple(sorted(self._records.values(), key=lambda item: item.updated_at, reverse=True))

    def get(self, key: str) -> HandledOrderRecord | None:
        # 该函数用于按 key 读取本地订单状态记录。
        with self._lock:
            return self._records.get(str(key or "").strip())

    def mark_order(
        self,
        order: ProblemOrder,
        *,
        order_number: str,
        platform_order_number: str,
        shop_name: str,
        order_source_text: str = "",
        allocation_status_text: str = "",
        shipping_status_text: str = "",
        audit_status_text: str = "",
        payment_time_text: str = "",
        refund_status_text: str = "",
        seller_remark_text: str = "",
    ) -> HandledOrderRecord:
        # 该函数用于把当前待处理订单标记为已人工处理并立即落盘。
        return self._upsert_order(
            order,
            order_number=order_number,
            platform_order_number=platform_order_number,
            shop_name=shop_name,
            order_source_text=order_source_text,
            allocation_status_text=allocation_status_text,
            shipping_status_text=shipping_status_text,
            audit_status_text=audit_status_text,
            payment_time_text=payment_time_text,
            refund_status_text=refund_status_text,
            seller_remark_text=seller_remark_text,
            handled=True,
        )

    def remember_order(
        self,
        order: ProblemOrder,
        *,
        order_number: str,
        platform_order_number: str,
        shop_name: str,
        order_source_text: str = "",
        allocation_status_text: str = "",
        shipping_status_text: str = "",
        audit_status_text: str = "",
        payment_time_text: str = "",
        refund_status_text: str = "",
        seller_remark_text: str = "",
    ) -> HandledOrderRecord:
        # 该函数用于把扫描到的订单快照落盘，保留已有人工处理状态不被扫描覆盖。
        return self._upsert_order(
            order,
            order_number=order_number,
            platform_order_number=platform_order_number,
            shop_name=shop_name,
            order_source_text=order_source_text,
            allocation_status_text=allocation_status_text,
            shipping_status_text=shipping_status_text,
            audit_status_text=audit_status_text,
            payment_time_text=payment_time_text,
            refund_status_text=refund_status_text,
            seller_remark_text=seller_remark_text,
            handled=None,
        )

    def set_handled(self, key: str, handled: bool) -> HandledOrderRecord:
        # 该函数用于反选或重新勾选已有本地订单记录，并保留订单快照不丢失。
        text_key = str(key or "").strip()
        if not text_key:
            raise RuntimeError("更新处理状态失败：订单 key 不能为空")
        with self._lock:
            record = self._require_record(text_key, "更新处理状态失败")
            now = time.time()
            updated = replace(
                record,
                handled=bool(handled),
                verifying=False if handled else record.verifying,
                processing=False if handled else record.processing,
                marked_at=now if handled else record.marked_at,
                updated_at=now,
            )
            self._records[text_key] = updated
            self._save_records()
            return updated

    def set_verifying(self, key: str, verifying: bool) -> HandledOrderRecord:
        # 该函数用于更新订单“正在核实”状态，让刚开始看的订单从未处理大池子里单独挪出来。
        text_key = str(key or "").strip()
        if not text_key:
            raise RuntimeError("更新正在核实状态失败：订单 key 不能为空")
        with self._lock:
            record = self._require_record(text_key, "更新正在核实状态失败")
            if record.handled and verifying:
                raise RuntimeError("更新正在核实状态失败：已处理订单不能标记为正在核实。")
            updated = replace(record, verifying=bool(verifying), processing=False if verifying else record.processing, updated_at=time.time())
            self._records[text_key] = updated
            self._save_records()
            return updated

    def set_processing(self, key: str, processing: bool) -> HandledOrderRecord:
        # 该函数用于更新订单“处理中”状态，状态仍属于未处理列，不改变最终处理结果。
        text_key = str(key or "").strip()
        if not text_key:
            raise RuntimeError("更新处理中状态失败：订单 key 不能为空")
        with self._lock:
            record = self._require_record(text_key, "更新处理中状态失败")
            if record.handled and processing:
                raise RuntimeError("更新处理中状态失败：已处理订单不能标记为处理中。")
            updated = replace(record, verifying=False if processing else record.verifying, processing=bool(processing), updated_at=time.time())
            self._records[text_key] = updated
            self._save_records()
            return updated

    def set_note(self, key: str, note_text: str) -> HandledOrderRecord:
        # 该函数用于保存订单备注，备注跟随订单本地快照持久保存。
        text_key = str(key or "").strip()
        if not text_key:
            raise RuntimeError("保存订单备注失败：订单 key 不能为空")
        with self._lock:
            record = self._require_record(text_key, "保存订单备注失败")
            updated = replace(record, note_text=normalize_order_note_text(note_text), updated_at=time.time())
            self._records[text_key] = updated
            self._save_records()
            return updated

    def _upsert_order(
        self,
        order: ProblemOrder,
        *,
        order_number: str,
        platform_order_number: str,
        shop_name: str,
        order_source_text: str,
        allocation_status_text: str,
        shipping_status_text: str,
        audit_status_text: str,
        payment_time_text: str,
        refund_status_text: str,
        seller_remark_text: str,
        handled: bool | None,
    ) -> HandledOrderRecord:
        # 该函数用于统一写入订单快照，避免已处理和未处理走两套存储逻辑。
        key = str(order.key or "").strip()
        if not key:
            raise RuntimeError("保存订单状态失败：订单缺少唯一 key")
        clean_platform_order_number = str(platform_order_number or "").strip()
        if not is_valid_platform_order_text(clean_platform_order_number):
            raise RuntimeError("保存订单状态失败：平台单号无效，禁止进入订单列表")
        now = time.time()
        with self._lock:
            existing = self._records.get(key)
            next_handled = bool(existing.handled) if existing is not None and handled is None else bool(handled)
            next_verifying = bool(existing.verifying) if existing is not None else False
            next_processing = bool(existing.processing) if existing is not None else False
            if next_handled:
                next_verifying = False
                next_processing = False
            if next_processing:
                next_verifying = False
            record = HandledOrderRecord(
                key=key,
                handled=next_handled,
                verifying=next_verifying,
                processing=next_processing,
                added_at=existing.added_at if existing is not None and existing.added_at else now,
                marked_at=now if handled is True else (existing.marked_at if existing is not None else 0),
                updated_at=now,
                summary=order.summary,
                order_number=str(order_number or ""),
                platform_order_number=clean_platform_order_number,
                shop_name=str(shop_name or ""),
                order_source_text=str(order_source_text or ""),
                allocation_status_text=str(allocation_status_text or ""),
                shipping_status_text=str(shipping_status_text or ""),
                audit_status_text=str(audit_status_text or ""),
                payment_time_text=str(payment_time_text or ""),
                refund_status_text=str(refund_status_text or ""),
                seller_remark_text=str(seller_remark_text or ""),
                note_text=existing.note_text if existing is not None else "",
                row_label=f"第{order.row_index + 1}行",
                identity=str(order.identity or ""),
            )
            self._records[key] = record
            self._save_records()
            return record

    def _require_record(self, key: str, action: str) -> HandledOrderRecord:
        # 该函数用于统一读取必须存在的记录，让错误原因保持一致。
        record = self._records.get(str(key or "").strip())
        if record is None:
            raise RuntimeError(f"{action}：本地没有该订单记录，请先重新扫描。")
        return record

    def _save_records(self) -> None:
        # 该函数用于把当前有效订单状态写回文件，并自动迁移过期已处理历史。
        self._records = save_order_records(self.path, self._records, archive_root=self.archive_root, policy=self.retention_policy)


__all__ = ["HandledOrderStore"]
