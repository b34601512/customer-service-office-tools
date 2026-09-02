"""该文件集中处理号码、时间和时长归一化，避免多个模块各写一套规则。"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any


def normalize_phone(raw_phone: Any) -> str:
    """统一号码格式，避免 Excel 把号码当数字或文本造成匹配失败。"""
    if isinstance(raw_phone, float) and raw_phone.is_integer():
        raw_phone = int(raw_phone)
    digits = re.sub(r"\D", "", str(raw_phone or ""))
    return digits


def normalize_agent_extension(raw_extension: Any) -> str:
    """把平台长坐席号归一为短分机，但保留手机号坐席，避免客服身份被截断。"""
    if isinstance(raw_extension, float) and raw_extension.is_integer():
        raw_extension = int(raw_extension)
    digits = re.sub(r"\D", "", str(raw_extension or ""))
    if len(digits) == 11 and digits.startswith("1"):
        return digits
    if len(digits) > 4:
        return digits[-4:]
    return digits


def parse_datetime(raw_value: Any) -> datetime | None:
    """解析 Excel 文本时间，解析失败直接返回 None 让上层丢弃异常行。"""
    if isinstance(raw_value, datetime):
        return raw_value
    if isinstance(raw_value, (int, float)):
        return datetime(1899, 12, 30) + timedelta(days=float(raw_value))
    value = str(raw_value or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def parse_duration_seconds(raw_value: Any) -> int:
    """把 00:01:23 这类时长转成秒数，便于排序和打分。"""
    value = str(raw_value or "").strip()
    match = re.match(r"^(\d+):(\d{1,2}):(\d{1,2})$", value)
    if not match:
        return 0
    hours, minutes, seconds = (int(part) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def format_seconds(total_seconds: int) -> str:
    """把秒数格式化成简短中文，给页面直接展示。"""
    minutes, seconds = divmod(int(max(total_seconds, 0)), 60)
    if minutes:
        return f"{minutes}分{seconds}秒"
    return f"{seconds}秒"


def first_value(row: dict[str, Any], names: list[str]) -> Any:
    """按候选字段名读取第一个非空值，用来兼容不同导出表头。"""
    for name in names:
        value = row.get(name)
        if str(value or "").strip():
            return value
    return ""
