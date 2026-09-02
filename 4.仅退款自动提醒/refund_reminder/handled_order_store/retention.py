# 该文件用于决定哪些订单状态继续留在当前文件里。
from __future__ import annotations

from dataclasses import dataclass

from .record import HandledOrderRecord

SECONDS_PER_DAY = 24 * 60 * 60


@dataclass(frozen=True)
class HandledOrderRetentionPolicy:
    handled_keep_days: int = 90
    max_current_records: int = 2000


def is_protected_record(record: HandledOrderRecord) -> bool:
    # 该函数用于保护仍需人工处理的订单，避免自动保留策略误移走当前工作。
    return not record.handled or record.verifying or record.processing


def split_records_by_retention(
    records: dict[str, HandledOrderRecord],
    *,
    now: float,
    policy: HandledOrderRetentionPolicy,
) -> tuple[dict[str, HandledOrderRecord], dict[str, HandledOrderRecord]]:
    # 该函数用于把当前有效记录和应迁移历史记录分开，避免订单状态文件无限增长。
    if int(policy.handled_keep_days) < 1:
        raise RuntimeError("订单状态保留策略错误：handled_keep_days 必须大于 0")
    if int(policy.max_current_records) < 1:
        raise RuntimeError("订单状态保留策略错误：max_current_records 必须大于 0")
    cutoff = float(now) - int(policy.handled_keep_days) * SECONDS_PER_DAY
    protected = {key: record for key, record in records.items() if is_protected_record(record)}
    handled_recent = {
        key: record
        for key, record in records.items()
        if key not in protected and float(record.updated_at or record.marked_at or record.added_at or 0) >= cutoff
    }
    kept = {**protected, **handled_recent}
    if len(kept) > int(policy.max_current_records):
        kept = trim_oldest_unprotected_records(kept, policy.max_current_records)
    archived = {key: record for key, record in records.items() if key not in kept}
    return kept, archived


def trim_oldest_unprotected_records(records: dict[str, HandledOrderRecord], max_records: int) -> dict[str, HandledOrderRecord]:
    # 该函数用于在记录数量超过上限时只裁掉最老的已处理历史，不碰未处理工作。
    protected = {key: record for key, record in records.items() if is_protected_record(record)}
    handled = [(key, record) for key, record in records.items() if key not in protected]
    remaining_slots = max(0, int(max_records) - len(protected))
    newest_handled = sorted(handled, key=lambda item: item[1].updated_at, reverse=True)[:remaining_slots]
    return {**protected, **{key: record for key, record in newest_handled}}


__all__ = ["HandledOrderRetentionPolicy", "is_protected_record", "split_records_by_retention", "trim_oldest_unprotected_records"]
