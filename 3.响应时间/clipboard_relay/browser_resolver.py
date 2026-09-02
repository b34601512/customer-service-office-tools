#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import shutil
from pathlib import Path

from .config import LoginFlowConfig


def candidate_browsers(configured: str) -> list[str]:
    # 该函数用于寻找可被 Playwright 直接控制的 Chrome/Edge 浏览器路径。
    out: list[str] = []
    if str(configured or "").strip():
        out.append(str(configured).strip())
    for name in ("chrome", "msedge"):
        path = shutil.which(name)
        if path:
            out.append(path)
    program_files = [
        os.environ.get("ProgramFiles", ""),
        os.environ.get("ProgramFiles(x86)", ""),
        os.environ.get("LocalAppData", ""),
    ]
    suffixes = [
        Path("Google") / "Chrome" / "Application" / "chrome.exe",
        Path("Microsoft") / "Edge" / "Application" / "msedge.exe",
    ]
    for root in program_files:
        if root:
            for suffix in suffixes:
                out.append(str(Path(root) / suffix))
    seen: set[str] = set()
    unique: list[str] = []
    for item in out:
        text = str(item or "").strip()
        if text and text.lower() not in seen:
            seen.add(text.lower())
            unique.append(text)
    return unique


def resolve_browser_executable(login_flow: LoginFlowConfig) -> str:
    # 该函数用于显式定位浏览器；找不到就直接失败，避免后面变成黑箱报错。
    for exe in candidate_browsers(login_flow.browser_executable):
        if shutil.which(exe) is not None or Path(exe).exists():
            return str(exe)
    raise RuntimeError("未找到可用的 Chrome/Edge，请在后台配置浏览器路径")


__all__ = ["candidate_browsers", "resolve_browser_executable"]
