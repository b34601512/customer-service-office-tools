#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from ..logger import log

_MODULE = "clipboard_relay.browser_control"
_STARTUP_STATE_POLL_SEC = 0.2
_STARTUP_STATUS_LOG_INTERVAL_SEC = 5.0


def _log_browser(action: str, sub_action: str, **kwargs: Any) -> None:
    # 该函数让浏览器控制日志稳定定位到本模块调用行，避免线程入口显示成 threading.py。
    log("Browser", action, _MODULE, sub_action, **kwargs)


__all__ = ["_MODULE", "_STARTUP_STATE_POLL_SEC", "_STARTUP_STATUS_LOG_INTERVAL_SEC", "_log_browser"]
