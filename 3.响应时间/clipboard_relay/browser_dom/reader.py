#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from .scripts import _REPLY_INPUT_PAGE_VALUE_SCRIPT, _REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS, _REPLY_INPUT_SELECTOR

def read_input_value(locator: Any) -> str:
    # 该函数用于从普通输入框或富文本编辑器读取当前文本。
    return str(
        locator.evaluate(
            """node => {
                if ('value' in node) return node.value || '';
                return node.innerText || node.textContent || '';
            }""",
            timeout=_REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS,
        )
        or ""
    )

def _read_reply_input_value_from_page(page: Any) -> str:
    # 该函数用于绕过失效 locator，从当前页面重新选择最佳输入框回读。
    result = page.evaluate(_REPLY_INPUT_PAGE_VALUE_SCRIPT, _REPLY_INPUT_SELECTOR)
    if not isinstance(result, dict):
        raise RuntimeError(f"页面级读取输入框失败：页面返回了非对象状态，当前值={result!r}")
    if not bool(result.get("ok")):
        raise RuntimeError(
            "页面级读取输入框失败："
            f"{result.get('reason') or '未知原因'}；"
            f"候选={int(result.get('count') or 0)}，"
            f"可见={int(result.get('visible_count') or 0)}，"
            f"可编辑={int(result.get('editable_count') or 0)}"
        )
    return str(result.get("value") or "")

__all__ = ["read_input_value", "_read_reply_input_value_from_page"]
