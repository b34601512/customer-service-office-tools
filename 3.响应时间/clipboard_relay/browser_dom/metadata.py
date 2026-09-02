#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from ..logger import log
from .scripts import _MODULE, _REPLY_INPUT_META_SCRIPT, _REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS
from .state import _default_reply_input_meta, _meta_from_reply_input_state, _read_reply_input_state

def _read_reply_input_meta(page: Any, locator: Any) -> dict[str, Any]:
    # 该函数用于优先从页面级状态读取元信息，避免 locator 在页面卡顿时触发固定超时。
    page_error: BaseException | None = None
    locator_error: BaseException | None = None
    try:
        meta = _meta_from_reply_input_state(_read_reply_input_state(page))
        if meta is not None:
            return meta
    except BaseException as exc:
        page_error = exc
    try:
        meta = locator.evaluate(_REPLY_INPUT_META_SCRIPT, timeout=_REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS)
        if isinstance(meta, dict):
            return meta
        locator_error = RuntimeError(f"页面返回了非对象状态，当前值={meta!r}")
    except BaseException as exc:
        locator_error = exc
    log(
        "Browser",
        "读取输入框元信息失败",
        _MODULE,
        "_read_reply_input_meta",
        page_error="" if page_error is None else f"{type(page_error).__name__}: {page_error}",
        locator_error="" if locator_error is None else f"{type(locator_error).__name__}: {locator_error}",
    )
    return _default_reply_input_meta()

__all__ = ["_read_reply_input_meta"]
