#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
from pathlib import Path


def is_frozen() -> bool:
    # 该函数用于判断当前是否是 PyInstaller 打包后的运行形态。
    return bool(getattr(sys, "frozen", False))


def get_app_root() -> Path:
    # 该函数用于定位用户可写项目根目录，源码和打包后路径保持同一语义。
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def get_bundle_root() -> Path:
    # 该函数用于定位只读资源目录，打包后资源在 _MEIPASS。
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS")).resolve()  # type: ignore[arg-type]
    return Path(__file__).resolve().parents[1]


def get_web_root() -> Path:
    # 该函数用于统一定位本地后台网页资源。
    return get_bundle_root() / "refund_reminder" / "web_control" / "web"


__all__ = ["get_app_root", "get_bundle_root", "get_web_root", "is_frozen"]

