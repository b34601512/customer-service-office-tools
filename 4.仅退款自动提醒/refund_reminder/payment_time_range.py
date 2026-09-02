#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Iterable

from .order_detector import ProblemOrder
from .order_presenter import extract_payment_time_text


def parse_payment_date(value: str) -> date | None:
    # 该函数只解析支付时间开头的本地日期，避免完整时间字符串被时区规则改天。
    match = re.match(r"^\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})", str(value or ""))
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def payment_date_in_recent_days(value: str, days: int, *, today: date | None = None) -> bool:
    # 该函数判断支付日期是否落在最近 N 天内，1 天等于今天。
    payment_date = parse_payment_date(value)
    if payment_date is None:
        return False
    current = today or date.today()
    safe_days = max(1, int(days))
    start = current - timedelta(days=safe_days - 1)
    return start <= payment_date <= current


def filter_orders_by_payment_time_range(orders: Iterable[ProblemOrder], days: int, *, today: date | None = None) -> tuple[ProblemOrder, ...]:
    # 该函数在系统通知前过滤付款时间，后台列表仍保留完整扫描结果。
    return tuple(
        order
        for order in orders
        if payment_date_in_recent_days(extract_payment_time_text(order), days, today=today)
    )


__all__ = ["filter_orders_by_payment_time_range", "parse_payment_date", "payment_date_in_recent_days"]
