#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
from pathlib import Path


def is_frozen() -> bool:
    # 该函数用于判断当前是否运行在打包后的可执行文件里。
    return bool(getattr(sys, "frozen", False))


def get_app_root() -> Path:
    # 该函数用于定位用户可写的数据根目录；打包后固定在 exe 同级目录。
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def get_bundle_root() -> Path:
    # 该函数用于定位内置资源目录；源码模式是项目根目录，打包模式是 _MEIPASS。
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS")).resolve()  # type: ignore[arg-type]
    return Path(__file__).resolve().parents[1]


def get_web_root() -> Path:
    # 该函数用于统一定位网页后台静态资源目录。
    return get_bundle_root() / "clipboard_relay" / "web_control" / "web"


__all__ = ["get_app_root", "get_bundle_root", "get_web_root", "is_frozen"]
