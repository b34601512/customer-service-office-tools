#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any

from .config import DetectionConfig

PAYMENT_TIME_COLUMN_NAMES = ("支付日期", "支付时间", "付款时间")
REFUND_EVIDENCE_COLUMN_NAMES = ("退款", "退款状态", "订单标签", "异常信息")
REFUND_EVIDENCE_KEYWORDS = ("√", "退款", "全部退款", "部分退款")
PLATFORM_ORDER_COLUMN_NAMES = ("平台单号", "平台订单号")
PLATFORM_ORDER_ALLOWED_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{3,}$")


@dataclass(frozen=True)
class ProblemOrder:
    row_index: int
    identity: str
    summary: str
    key: str
    row: dict[str, str]
    payment_time_text: str = ""
    refund_status_text: str = ""


@dataclass(frozen=True)
class RowDetectionDebug:
    row_index: int
    identity: str
    payment_time_text: str
    refund_evidence_text: str
    payment_time_found: bool
    refund_evidence_found: bool
    is_problem: bool
    reason: str
    raw_cell_count: int
    aligned_cell_count: int
    alignment_note: str
    nearby_cells: tuple[str, ...]


@dataclass(frozen=True)
class DetectionResult:
    total_rows: int
    problem_orders: tuple[ProblemOrder, ...]
    source: str
    headers: tuple[str, ...]
    row_debugs: tuple[RowDetectionDebug, ...]


def normalize_text(value: Any) -> str:
    # 该函数用于统一清洗 ERP 单元格文本，避免空格换行影响判断。
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


def normalize_header(value: Any) -> str:
    # 该函数用于清洗表头文本，降低不同控件渲染差异带来的误差。
    return re.sub(r"[\s:：]+", "", str(value or "").replace("\u00a0", " ")).strip()


def is_valid_platform_order_text(value: Any) -> bool:
    # 该函数用于过滤 ERP 页面内部配置值，平台单号只能由字母、数字、横线、下划线组成且必须含数字。
    text = normalize_text(value).replace(" ", "")
    return bool(text and PLATFORM_ORDER_ALLOWED_PATTERN.fullmatch(text) and re.search(r"\d", text))


def find_optional_column_index(headers: list[str], names: tuple[str, ...]) -> int | None:
    # 该函数用于在导出表里定位业务列，缺列时交给诊断原因说明。
    normalized_headers = [normalize_header(item) for item in headers]
    normalized_names = [normalize_header(item) for item in names]
    for name in normalized_names:
        if name in normalized_headers:
            return normalized_headers.index(name)
    for index, header in enumerate(normalized_headers):
        if any(name and name in header for name in normalized_names):
            return index
    return None


def _row_to_dict(headers: list[str], row: list[Any]) -> dict[str, str]:
    # 该函数用于把行数组转换成表头字典，便于后台展示订单摘要。
    out: dict[str, str] = {}
    for index, header in enumerate(headers):
        name = normalize_text(header) or f"第{index + 1}列"
        out[name] = normalize_text(row[index] if index < len(row) else "")
    return out


def _build_identity(row_map: dict[str, str], identity_columns: tuple[str, ...], row_index: int) -> str:
    # 该函数用于生成稳定的人类可读订单标识，优先使用配置里的业务列。
    parts: list[str] = []
    normalized_map = {normalize_header(key): value for key, value in row_map.items()}
    for name in identity_columns:
        value = normalized_map.get(normalize_header(name), "")
        if value:
            parts.append(f"{name}:{value}")
    return " | ".join(parts) if parts else f"第{row_index + 1}行"


def _recognized_platform_order(row_map: dict[str, str]) -> str:
    # 该函数用于确认订单有可复制、可搜索的平台单号；没有平台单号的行不进入记录。
    normalized_map = {normalize_header(key): value for key, value in row_map.items()}
    for name in PLATFORM_ORDER_COLUMN_NAMES:
        value = normalize_text(normalized_map.get(normalize_header(name), ""))
        if is_valid_platform_order_text(value):
            return value
    return ""


def _build_key(identity: str, row_map: dict[str, str]) -> str:
    # 该函数用于生成去重 key，避免同一订单每次扫描都重复弹窗。
    raw = identity if not identity.startswith("第") else "|".join(f"{key}={value}" for key, value in sorted(row_map.items()))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _pick_row_value(row_map: dict[str, str], names: tuple[str, ...]) -> str:
    # 该函数按多个可能列名读取导出表字段，兼容 ERP 列名微调。
    normalized_map = {normalize_header(key): value for key, value in row_map.items()}
    for name in names:
        value = normalized_map.get(normalize_header(name), "")
        if value:
            return value
    return ""


def _refund_evidence_text(row_map: dict[str, str]) -> str:
    # 该函数用于确认当前导出行确实来自退款筛选页，避免用户误停在普通订单页。
    values = [_pick_row_value(row_map, (name,)) for name in REFUND_EVIDENCE_COLUMN_NAMES]
    for value in values:
        if value and any(keyword in value for keyword in REFUND_EVIDENCE_KEYWORDS):
            return value
    return ""


def detect_problem_orders_from_exported_rows(scan_payload: dict[str, Any], config: DetectionConfig) -> DetectionResult:
    # 该函数只判断导出行是否是退款订单，购买时间只交给前端做分类显示。
    headers = [normalize_text(item) for item in scan_payload.get("headers") or []]
    rows = list(scan_payload.get("rows") or [])
    source = normalize_text(scan_payload.get("source") or "未知来源")
    if not headers:
        raise RuntimeError("识别导出订单失败：订单查询.xlsx 没有表头")
    payment_date_index = find_optional_column_index(headers, PAYMENT_TIME_COLUMN_NAMES)
    if payment_date_index is None:
        raise RuntimeError(f"识别导出订单失败：找不到支付日期列，表头={headers!r}")
    problem_orders: list[ProblemOrder] = []
    row_debugs: list[RowDetectionDebug] = []
    for row_index, raw_row in enumerate(rows):
        raw_cells = list(raw_row or [])
        row = raw_cells[: len(headers)]
        row_map = _row_to_dict(headers, row)
        identity = _build_identity(row_map, config.identity_column_names, row_index)
        platform_order = _recognized_platform_order(row_map)
        payment_time_text = normalize_text(row[payment_date_index] if payment_date_index < len(row) else "")
        refund_evidence_text = _refund_evidence_text(row_map)
        payment_time_found = bool(payment_time_text)
        refund_evidence_found = bool(refund_evidence_text)
        is_problem = bool(refund_evidence_found and platform_order)
        if is_problem:
            reason = "命中：导出退款订单，进入页面并按配置付款范围提醒"
        elif not platform_order:
            reason = "跳过：平台单号为空或非法"
        elif not refund_evidence_found:
            reason = "跳过：导出行缺少退款证据，请确认 ERP 已筛选退款订单"
        else:
            reason = "跳过：未知原因"
        row_debugs.append(
            RowDetectionDebug(
                row_index=row_index,
                identity=identity,
                payment_time_text=payment_time_text,
                refund_evidence_text=refund_evidence_text,
                payment_time_found=payment_time_found,
                refund_evidence_found=refund_evidence_found,
                is_problem=is_problem,
                reason=reason,
                raw_cell_count=len(raw_cells),
                aligned_cell_count=len(row),
                alignment_note="导出表按退款证据采集，购买时间仅用于页面分类",
                nearby_cells=(),
            )
        )
        if not is_problem:
            continue
        row_label = f"第{row_index + 1}行"
        summary = row_label if not identity or identity == row_label else f"{row_label}｜{identity}"
        problem_orders.append(
            ProblemOrder(
                row_index=row_index,
                identity=identity,
                summary=summary,
                key=_build_key(identity, row_map),
                row=row_map,
                payment_time_text=payment_time_text,
                refund_status_text=refund_evidence_text,
            )
        )
    return DetectionResult(
        total_rows=len(rows),
        problem_orders=tuple(problem_orders),
        source=source,
        headers=tuple(headers),
        row_debugs=tuple(row_debugs),
    )


__all__ = [
    "DetectionResult",
    "ProblemOrder",
    "RowDetectionDebug",
    "detect_problem_orders_from_exported_rows",
    "find_optional_column_index",
    "is_valid_platform_order_text",
    "normalize_header",
    "normalize_text",
]
