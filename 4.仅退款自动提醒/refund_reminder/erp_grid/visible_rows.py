# 该文件用于扫描 ERP 当前可见订单行，只做快照反馈，不做刷新稳定判定。
from __future__ import annotations

from typing import Any

from ..browser_errors import _is_navigation_context_error
from ..config import AppConfig
from ..erp_scripts import SCAN_VISIBLE_ORDER_ROWS_SCRIPT
from ..logger import log
from .constants import MODULE_NAME
from .scan_config import order_row_scan_config


def scan_visible_order_rows_in_frames(page: Any, config: AppConfig) -> dict[str, Any]:
    # 该函数用于跨 frame 扫描当前可见订单行，避免横向滚动影响当前列表快照。
    frames = list(getattr(page, "frames", []) or [])
    payloads: list[dict[str, Any]] = []
    scan_config = order_row_scan_config(config)
    for index, frame in enumerate(frames):
        try:
            payload = dict(frame.evaluate(SCAN_VISIBLE_ORDER_ROWS_SCRIPT, scan_config) or {})
        except Exception as exc:
            if _is_navigation_context_error(exc):
                continue
            payload = {"source": f"frame{index}:scan-error", "headers": [], "rows": [], "error": str(exc)}
        source = str(payload.get("source") or "unknown")
        payload["source"] = f"frame{index}:{source}"
        payload["frame_url"] = str(getattr(frame, "url", "") or "")
        payloads.append(payload)
    if not payloads:
        return {"source": "no-frame", "headers": [], "rows": []}
    payloads.sort(key=lambda item: (1 if item.get("headers") else 0, len(item.get("rows") or [])), reverse=True)
    best = payloads[0]
    log(
        "Browser",
        "跨frame扫描可见订单行",
        MODULE_NAME,
        "scan_visible_order_rows_in_frames",
        frame_count=len(frames),
        source=best.get("source"),
        header_count=len(best.get("headers") or []),
        row_count=len(best.get("rows") or []),
        candidates=" | ".join(str(item) for item in best.get("candidate_sources") or ()),
    )
    return best


__all__ = ["scan_visible_order_rows_in_frames"]
