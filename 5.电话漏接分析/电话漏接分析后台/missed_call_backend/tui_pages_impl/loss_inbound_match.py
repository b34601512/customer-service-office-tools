"""呼损记录关联呼入表：判断呼损之后同一号码是否接通、首次接通时间。

口径（与用户确认）：仅在「呼损时间之后」该来电号码在呼入表出现，才算呼入成功；
呼入表只记录接通来电（通话时长恒>0），故主叫号码出现即视为接通。
成功标记直接存为带颜色的字符串，供呼损页列表/详情原样显示。
"""
from __future__ import annotations

import bisect
from datetime import datetime
from typing import Any

from ..cli_display import colorize


def norm_phone(value: Any) -> str:
    """仅保留数字，统一主叫/来电号码格式以便跨表匹配。"""
    if value is None:
        return ""
    return "".join(ch for ch in str(value).strip() if ch.isdigit())


def parse_time(value: Any) -> datetime | None:
    text = str(value).strip() if value is not None else ""
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def build_inbound_index(inbound_rows: list[dict[str, Any]] | None) -> dict[str, list[datetime]]:
    """按主叫号码建立呼入时间索引（升序）。"""
    index: dict[str, list[datetime]] = {}
    if not inbound_rows:
        return index
    for row in inbound_rows:
        num = norm_phone(row.get("主叫号码"))
        if not num:
            continue
        time = parse_time(row.get("呼入时间"))
        if time is None:
            continue
        index.setdefault(num, []).append(time)
    for times in index.values():
        times.sort()
    return index


def lookup_success_after(index: dict[str, list[datetime]], number: Any, loss_time: datetime | None) -> tuple[bool, str]:
    """返回 (呼损后是否接通, 首次接通时间文本)；仅统计呼损时间之后的呼入。"""
    times = index.get(norm_phone(number))
    if not times or loss_time is None:
        return False, ""
    position = bisect.bisect_right(times, loss_time)
    if position < len(times):
        return True, times[position].strftime("%Y-%m-%d %H:%M:%S")
    return False, ""


def enrich_loss_rows(
    inbound_rows: list[dict[str, Any]] | None,
    loss_rows: list[dict[str, Any]],
    time_column: str,
    group_column: str,
    cache_store: dict[str, Any],
    cache_key: str,
) -> list[dict[str, Any]]:
    """为每条呼损记录补充 __inbound_success / __inbound_success_time。

    结果按 cache_key（分析结果版本号）缓存到 cache_store["_inbound_success_cache"]，
    重新下载分析后自动失效。
    """
    cache = cache_store.get("_inbound_success_cache")
    if cache is not None and cache[0] == cache_key:
        return cache[1]
    index = build_inbound_index(inbound_rows)
    enriched: list[dict[str, Any]] = []
    for row in loss_rows:
        loss_time = parse_time(row.get(time_column))
        number = row.get(group_column)
        success, success_time = lookup_success_after(index, number, loss_time)
        new = dict(row)
        new["__inbound_success"] = colorize("是" if success else "否", "green" if success else "red")
        new["__inbound_success_time"] = success_time or "—"
        enriched.append(new)
    cache_store["_inbound_success_cache"] = (cache_key, enriched)
    return enriched
