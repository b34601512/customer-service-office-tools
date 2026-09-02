from __future__ import annotations

import sys
from pathlib import Path


def get_app_base_dir() -> Path:
    """返回程序真正的工作目录，打包后优先落在 exe 所在目录。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def get_resource_root() -> Path:
    """返回资源根目录，打包态优先使用 PyInstaller 解包目录。"""
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass).resolve()
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]
