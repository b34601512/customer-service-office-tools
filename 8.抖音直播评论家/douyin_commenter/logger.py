#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import inspect
import os
import sys
from datetime import datetime
from pathlib import Path
from threading import RLock
from typing import Any

_LOG_LOCK = RLock()
_LOG_FILE: Path | None = None


def init_logging(root_dir: str | Path) -> Path:
    # 该函数用于初始化本次运行唯一日志文件，启动时清空旧内容避免日志膨胀。
    global _LOG_FILE
    logs_dir = Path(root_dir) / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    _LOG_FILE = logs_dir / "current.log"
    _LOG_FILE.write_text("", encoding="utf-8")
    return _LOG_FILE


def get_log_file() -> Path | None:
    # 该函数用于给网页端读取当前运行日志路径。
    return _LOG_FILE


def _caller_location(stacklevel: int) -> str:
    # 该函数用于把日志定位到真实调用方，方便长期排查。
    try:
        frame = inspect.currentframe()
        for _ in range(int(stacklevel) + 1):
            if frame is None:
                return "?:?"
            frame = frame.f_back
        if frame is None:
            return "?:?"
        file_name = os.path.basename(str(frame.f_code.co_filename or "")) or "?:?"
        return f"{file_name}:{int(frame.f_lineno or 0) or '?'}"
    finally:
        del frame


def log(main: str, action: str, module: str, sub_action: str, **kwargs: Any) -> str:
    # 该函数用于输出统一终端日志，并同步写入本次运行日志文件。
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    location = _caller_location(2)
    main_action = f"{main}:{action}" if str(action or "").strip() else str(main or "")
    extra = " ".join(f"{key}={value!r}" for key, value in kwargs.items())
    line = f"[{now}][{location}][主线:{main_action}][{module}][{sub_action}]"
    if extra:
        line = f"{line} {extra}"
    with _LOG_LOCK:
        if sys.stdout is not None:
            print(line, flush=True)
        if _LOG_FILE is not None:
            with _LOG_FILE.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
    return line


__all__ = ["get_log_file", "init_logging", "log"]
