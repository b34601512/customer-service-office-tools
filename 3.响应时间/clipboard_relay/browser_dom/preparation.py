#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import time
from typing import Any

from ..logger import log
from .scripts import _MODULE, _REPLY_INPUT_ACTIVATE_SCRIPT, _REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS
from .state import _read_reply_input_ready_state, _reply_input_ready_summary

def _activate_reply_input(locator: Any) -> None:
    # 该函数用于通过 DOM 聚焦输入框，避开 Playwright 等待元素稳定导致的长时间阻塞。
    result = locator.evaluate(_REPLY_INPUT_ACTIVATE_SCRIPT, timeout=_REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS)
    if result is not True:
        raise RuntimeError(f"DOM 聚焦输入框失败：页面返回了异常状态，当前值={result!r}")


def _prepare_reply_input_for_write(locator: Any, *, action: str) -> BaseException | None:
    # 该函数用于写入前做非阻塞聚焦；失败只记录，真正成败以后续写入回读为准。
    started_at = time.monotonic()
    try:
        _activate_reply_input(locator)
        state = _read_reply_input_ready_state(locator)
        if bool(state.get("ready")):
            log(
                "Browser",
                "输入框焦点就绪",
                _MODULE,
                "_prepare_reply_input_for_write",
                wait_action=action,
                wait_ms=round((time.monotonic() - started_at) * 1000),
                state=_reply_input_ready_summary(state),
            )
            return None
        error = RuntimeError(f"输入框焦点未完全就绪：{_reply_input_ready_summary(state)}")
    except BaseException as exc:
        error = exc
    log(
        "Browser",
        "输入框焦点准备失败",
        _MODULE,
        "_prepare_reply_input_for_write",
        wait_action=action,
        wait_ms=round((time.monotonic() - started_at) * 1000),
        reason=f"{type(error).__name__}: {error}",
    )
    return error

__all__ = ["_activate_reply_input", "_prepare_reply_input_for_write"]
