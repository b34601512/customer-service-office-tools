# 该文件用于读写订单状态 JSON 和迁移过期历史记录。
from __future__ import annotations

import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from ..logger import log
from ..order_detector import is_valid_platform_order_text
from .record import HandledOrderRecord
from .retention import HandledOrderRetentionPolicy, split_records_by_retention
from .text_cleaning import clean_stored_order_text, normalize_order_note_text

MODULE_NAME = "refund_reminder.handled_order_store.file_storage"


def load_order_records(path: Path) -> dict[str, HandledOrderRecord]:
    # 该函数用于读取订单处理状态文件，文件损坏时直接抛错便于修根因。
    if not Path(path).exists():
        return {}
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise RuntimeError(f"读取已处理订单失败：{path}（{type(exc).__name__}: {exc}）") from exc
    if not isinstance(raw, dict):
        raise RuntimeError("读取已处理订单失败：根节点必须是对象")
    raw_orders = raw.get("orders", {})
    if not isinstance(raw_orders, dict):
        raise RuntimeError("读取已处理订单失败：orders 必须是对象")
    records: dict[str, HandledOrderRecord] = {}
    for key, item in raw_orders.items():
        record = build_record_from_raw_item(key, item)
        if record is not None:
            records[record.key] = record
    return records


def build_record_from_raw_item(key: str, item: Any) -> HandledOrderRecord | None:
    # 该函数用于把历史 JSON 字段转换成当前订单状态结构，兼容旧字段但不保留脏平台单号。
    if not isinstance(item, dict):
        raise RuntimeError(f"读取已处理订单失败：订单记录必须是对象，key={key!r}")
    text_key = str(item.get("key") or key or "").strip()
    if not text_key:
        return None
    platform_order_number = str(item.get("platform_order_number") or "").strip()
    if platform_order_number and not is_valid_platform_order_text(platform_order_number):
        platform_order_number = ""
    if not platform_order_number:
        return None
    handled_state = bool(item.get("handled", True))
    processing_state = bool(item.get("processing", False)) and not handled_state
    verifying_state = bool(item.get("verifying", False)) and not handled_state and not processing_state
    marked_at = float(item.get("marked_at") or 0)
    added_at = float(item.get("added_at") or item.get("updated_at") or marked_at or 0)
    return HandledOrderRecord(
        key=text_key,
        handled=handled_state,
        verifying=verifying_state,
        processing=processing_state,
        added_at=added_at,
        marked_at=marked_at,
        updated_at=float(item.get("updated_at") or marked_at),
        summary=clean_stored_order_text(str(item.get("summary") or "")),
        order_number=str(item.get("order_number") or ""),
        platform_order_number=platform_order_number,
        shop_name=str(item.get("shop_name") or ""),
        order_source_text=str(item.get("order_source_text") or ""),
        allocation_status_text=str(item.get("allocation_status_text") or ""),
        shipping_status_text=str(item.get("shipping_status_text") or ""),
        audit_status_text=str(item.get("audit_status_text") or ""),
        payment_time_text=str(item.get("payment_time_text") or item.get("refund_application_time_text") or item.get("payment_date_text") or ""),
        refund_status_text=str(item.get("refund_status_text") or item.get("refund_application_note_text") or ""),
        seller_remark_text=str(item.get("seller_remark_text") or ""),
        note_text=normalize_order_note_text(item.get("note_text") or ""),
        row_label=str(item.get("row_label") or ""),
        identity=clean_stored_order_text(str(item.get("identity") or "")),
    )


def save_order_records(
    path: Path,
    records: dict[str, HandledOrderRecord],
    *,
    archive_root: Path,
    policy: HandledOrderRetentionPolicy,
) -> dict[str, HandledOrderRecord]:
    # 该函数用于保存当前订单状态，并把过期已处理历史迁移出当前文件。
    kept, archived = split_records_by_retention(records, now=time.time(), policy=policy)
    if archived:
        archive_order_records(archive_root, archived)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "version": 16,
        "retention": {
            "handled_keep_days": int(policy.handled_keep_days),
            "max_current_records": int(policy.max_current_records),
        },
        "orders": {key: asdict(record) for key, record in sorted(kept.items())},
    }
    Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return kept


def archive_order_records(archive_root: Path, records: dict[str, HandledOrderRecord]) -> Path:
    # 该函数用于把过期已处理历史迁移到备份目录，避免当前运行文件无限膨胀。
    target_dir = Path(archive_root)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"handled_orders_archive_{time.strftime('%Y%m%d-%H%M%S')}_{int(time.time() * 1000) % 1000:03d}.json"
    payload = {
        "version": 1,
        "archived_at": time.time(),
        "orders": {key: asdict(record) for key, record in sorted(records.items())},
    }
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log("Runtime", "迁移过期订单状态", MODULE_NAME, "archive_order_records", count=len(records), target=str(target))
    return target


__all__ = ["archive_order_records", "build_record_from_raw_item", "load_order_records", "save_order_records"]
