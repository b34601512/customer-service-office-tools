#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any


def as_float(raw: Any, *, field: str, min_value: float | None = None) -> float:
    # 该函数用于把配置数字统一校验成 float，避免空值或字符串悄悄污染主流程。
    try:
        value = float(raw)
    except Exception as exc:
        raise RuntimeError(f"配置错误：{field} 必须是数字，当前值={raw!r}") from exc
    if min_value is not None and value < float(min_value):
        raise RuntimeError(f"配置错误：{field} 不能小于 {min_value}，当前值={value}")
    return value


def as_int(raw: Any, *, field: str, min_value: int | None = None) -> int:
    # 该函数用于把配置整数统一校验，避免轮数等关键参数进入异常状态。
    try:
        value = int(raw)
    except Exception as exc:
        raise RuntimeError(f"配置错误：{field} 必须是整数，当前值={raw!r}") from exc
    if min_value is not None and value < int(min_value):
        raise RuntimeError(f"配置错误：{field} 不能小于 {min_value}，当前值={value}")
    return value


def as_keywords(raw: Any, *, field: str) -> tuple[str, ...]:
    # 该函数用于清洗窗口标题关键字，避免空字符串导致误匹配。
    if not isinstance(raw, list):
        raise RuntimeError(f"配置错误：{field} 必须是字符串列表")
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    if not out:
        raise RuntimeError(f"配置错误：{field} 至少需要一个有效关键字")
    return tuple(out)


def as_ratio(raw: Any, *, field: str) -> tuple[float, float]:
    # 该函数用于校验兜底点击比例，确保点击位置始终落在窗口内部。
    if not isinstance(raw, list) or len(raw) != 2:
        raise RuntimeError(f"配置错误：{field} 必须是长度为 2 的数组，例如 [0.5, 0.86]")
    x = as_float(raw[0], field=f"{field}[0]", min_value=0.0)
    y = as_float(raw[1], field=f"{field}[1]", min_value=0.0)
    if x > 1.0 or y > 1.0:
        raise RuntimeError(f"配置错误：{field} 的两个值必须在 0 到 1 之间，当前值={raw!r}")
    return float(x), float(y)


def as_bool(raw: Any, *, field: str) -> bool:
    # 该函数用于把配置布尔值统一收口，避免字符串误当成 True。
    if isinstance(raw, bool):
        return bool(raw)
    if isinstance(raw, str):
        text = raw.strip().lower()
        if text in {"true", "1", "yes", "on"}:
            return True
        if text in {"false", "0", "no", "off"}:
            return False
    raise RuntimeError(f"配置错误：{field} 必须是布尔值，当前值={raw!r}")


def json_number(value: float | int) -> float | int:
    # 该函数用于把整数型浮点写成整数，避免默认配置看起来像必须填小数。
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value

