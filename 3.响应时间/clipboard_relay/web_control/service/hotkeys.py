#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import threading

from ...hotkeys import HotkeyEvents


class ControlHotkeys:
    def __init__(self) -> None:
        # 该对象用于把网页按钮和全局热键统一转换成控制事件。
        self._lock = threading.Lock()
        self._pause_resume = False
        self._stop = False

    def request_pause_resume(self) -> None:
        # 该函数用于记录一次暂停或继续请求，等待主流程轮询取走。
        with self._lock:
            self._pause_resume = True

    def request_stop(self) -> None:
        # 该函数用于记录一次停止请求，等待主流程轮询取走。
        with self._lock:
            self._stop = True

    def poll(self) -> HotkeyEvents:
        # 该函数用于一次性取走网页按钮产生的控制事件，避免重复触发。
        with self._lock:
            events = HotkeyEvents(pause_resume=self._pause_resume, stop=self._stop)
            self._pause_resume = False
            self._stop = False
            return events


__all__ = ["ControlHotkeys"]
