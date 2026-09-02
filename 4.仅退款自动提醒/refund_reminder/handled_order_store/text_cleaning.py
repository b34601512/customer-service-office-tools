# 该文件用于清洗订单状态里的用户文本和历史脏数据。
from __future__ import annotations

import re
from typing import Any

from ..order_detector import is_valid_platform_order_text

ORDER_NOTE_TEXT_LIMIT = 200


def normalize_order_note_text(value: Any) -> str:
    # 该函数用于统一清洗订单备注，避免过长备注把卡片和存储文件撑乱。
    text = str(value or "").strip()
    if len(text) > ORDER_NOTE_TEXT_LIMIT:
        raise RuntimeError(f"保存订单备注失败：备注不能超过 {ORDER_NOTE_TEXT_LIMIT} 个字")
    return text


def clean_stored_order_text(value: str) -> str:
    # 该函数用于隐藏历史脏平台单号，避免页面内部配置值继续冒充订单号展示。
    text = str(value or "").strip()
    match = re.search(r"(平台(?:订单号|单号))[:：]([^｜\s]+)", text)
    if not match:
        return text
    if is_valid_platform_order_text(match.group(2)):
        return text
    if "｜" in text:
        return text.split("｜", 1)[0].strip()
    return ""


__all__ = ["ORDER_NOTE_TEXT_LIMIT", "clean_stored_order_text", "normalize_order_note_text"]
