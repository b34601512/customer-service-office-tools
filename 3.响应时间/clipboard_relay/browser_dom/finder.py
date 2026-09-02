#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import time
from typing import Any

from ..config import TargetConfig
from ..logger import log
from .scripts import _MODULE, _REPLY_INPUT_POLL_INTERVAL_SEC, _REPLY_INPUT_PROGRESS_LOG_SEC, _REPLY_INPUT_SELECTOR, _REPLY_INPUT_WAIT_TIMEOUT_SEC
from .state import _read_reply_input_state, _reply_input_state_summary

def find_reply_input(page: Any, target: TargetConfig) -> Any:
    # 该函数用于持续等待回复输入框进入可写状态，避免页面重绘时被 300ms 固定等待误判。
    started_at = time.monotonic()
    deadline = started_at + _REPLY_INPUT_WAIT_TIMEOUT_SEC
    last_progress_log = 0.0
    last_state: dict[str, Any] | None = None
    last_error: BaseException | None = None
    attempts = 0
    while True:
        attempts += 1
        try:
            last_state = _read_reply_input_state(page)
            best = last_state.get("best")
            if isinstance(best, dict):
                locator = page.locator(_REPLY_INPUT_SELECTOR).nth(int(best["index"]))
                log(
                    "Browser",
                    "定位输入框",
                    _MODULE,
                    "find_reply_input",
                    target=target.name,
                    attempts=attempts,
                    wait_ms=round((time.monotonic() - started_at) * 1000),
                    candidate_count=int(last_state.get("count") or 0),
                    visible_count=int(last_state.get("visible_count") or 0),
                    editable_count=int(last_state.get("editable_count") or 0),
                    x=round(float(best["x"]), 1),
                    y=round(float(best["y"]), 1),
                    width=round(float(best["width"]), 1),
                    height=round(float(best["height"]), 1),
                )
                return locator
        except BaseException as exc:
            last_error = exc
        now = time.monotonic()
        if now >= deadline:
            state_summary = _reply_input_state_summary(last_state)
            error_summary = f"；最后错误={type(last_error).__name__}: {last_error}" if last_error else ""
            raise RuntimeError(f"未找到可用输入框：{target.name}；{state_summary}{error_summary}")
        if now - last_progress_log >= _REPLY_INPUT_PROGRESS_LOG_SEC:
            last_progress_log = now
            log(
                "Browser",
                "等待输入框就绪",
                _MODULE,
                "find_reply_input.waiting",
                target=target.name,
                attempts=attempts,
                elapsed_ms=round((now - started_at) * 1000),
                state=_reply_input_state_summary(last_state),
                last_error=f"{type(last_error).__name__}: {last_error}" if last_error else "",
            )
        time.sleep(_REPLY_INPUT_POLL_INTERVAL_SEC)

__all__ = ["find_reply_input"]
