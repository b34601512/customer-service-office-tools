#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import ctypes
from dataclasses import dataclass

from .logger import log

_MODULE = "clipboard_relay.hotkeys"

_VK_MAP = {
    "F1": 0x70,
    "F2": 0x71,
    "F3": 0x72,
    "F4": 0x73,
    "F5": 0x74,
    "F6": 0x75,
    "F7": 0x76,
    "F8": 0x77,
    "F9": 0x78,
    "F10": 0x79,
    "F11": 0x7A,
    "F12": 0x7B,
}


@dataclass(frozen=True)
class HotkeyEvents:
    pause_resume: bool = False
    stop: bool = False


class HotkeyPoller:
    def __init__(self, *, pause_resume_key: str, stop_key: str) -> None:
        # 该对象用于轮询全局按键边沿，避免额外引入 keyboard 这类依赖。
        self._user32 = ctypes.windll.user32
        self._user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
        self._user32.GetAsyncKeyState.restype = ctypes.c_short
        self._pause_vk = self._resolve_vk(pause_resume_key)
        self._stop_vk = self._resolve_vk(stop_key)
        self._last_pause_down = False
        self._last_stop_down = False
        log("Control", "初始化热键", _MODULE, "__init__", pause_resume=pause_resume_key, stop=stop_key)

    @staticmethod
    def _resolve_vk(key: str) -> int:
        # 该函数用于把配置中的热键名称转换为 Windows 虚拟键码。
        name = str(key or "").strip().upper()
        if name not in _VK_MAP:
            raise RuntimeError(f"热键配置错误：暂只支持 F1-F12，当前值={key!r}")
        return int(_VK_MAP[name])

    def poll(self) -> HotkeyEvents:
        # 该函数用于检测本轮是否刚刚按下暂停/停止键。
        pause_down = bool(self._user32.GetAsyncKeyState(int(self._pause_vk)) & 0x8000)
        stop_down = bool(self._user32.GetAsyncKeyState(int(self._stop_vk)) & 0x8000)
        pause_event = pause_down and not self._last_pause_down
        stop_event = stop_down and not self._last_stop_down
        self._last_pause_down = pause_down
        self._last_stop_down = stop_down
        return HotkeyEvents(pause_resume=bool(pause_event), stop=bool(stop_event))


__all__ = ["HotkeyEvents", "HotkeyPoller"]
