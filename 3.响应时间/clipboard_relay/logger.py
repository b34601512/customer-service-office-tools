#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import sys
from datetime import datetime
from typing import Any


def _caller_location(stacklevel: int) -> str:
    # 该函数用于把日志定位到调用方，避免排查时只能看到日志模块自身。
    try:
        frame = sys._getframe(int(stacklevel) + 1)  # type: ignore[attr-defined]
    except Exception:
        return "?:?"
    try:
        name = os.path.basename(str(frame.f_code.co_filename or "")) or "?:?"
        return f"{name}:{int(frame.f_lineno or 0) or '?'}"
    finally:
        del frame


def log(main: str, action: str, module: str, sub_action: str, **kwargs: Any) -> None:
    # 该函数用于输出统一格式终端日志，方便按主线动作定位问题。
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    location = _caller_location(2)
    main_action = f"{main}:{action}" if str(action or "").strip() else str(main or "")
    extra = " ".join(f"{k}={v!r}" for k, v in kwargs.items())
    line = f"[{now}][{location}][主线:{main_action}][{module}][{sub_action}]"
    if extra:
        line = f"{line} {extra}"
    print(line, flush=True)


__all__ = ["log"]
