#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import shutil
from pathlib import Path


def candidate_browsers(configured_path: str) -> list[str]:
    # 该函数用于寻找可被 Playwright 直接控制的 Chrome 或 Edge 浏览器路径。
    candidates: list[str] = []
    configured = str(configured_path or "").strip()
    if configured:
        candidates.append(configured)
    for command_name in ("chrome", "msedge"):
        command_path = shutil.which(command_name)
        if command_path:
            candidates.append(command_path)
    program_roots = [
        os.environ.get("ProgramFiles", ""),
        os.environ.get("ProgramFiles(x86)", ""),
        os.environ.get("LocalAppData", ""),
    ]
    suffixes = [
        Path("Google") / "Chrome" / "Application" / "chrome.exe",
        Path("Microsoft") / "Edge" / "Application" / "msedge.exe",
    ]
    for root in program_roots:
        if not root:
            continue
        for suffix in suffixes:
            candidates.append(str(Path(root) / suffix))
    seen: set[str] = set()
    unique_candidates: list[str] = []
    for item in candidates:
        value = str(item or "").strip()
        key = value.lower()
        if not value or key in seen:
            continue
        seen.add(key)
        unique_candidates.append(value)
    return unique_candidates


def resolve_browser_executable(configured_path: str) -> str:
    # 该函数用于显式定位浏览器，找不到就直接失败避免后续黑箱报错。
    for executable in candidate_browsers(configured_path):
        if shutil.which(executable) is not None or Path(executable).exists():
            return str(executable)
    raise RuntimeError("未找到可用的 Chrome/Edge，请在配置弹窗填写浏览器路径。")


__all__ = ["candidate_browsers", "resolve_browser_executable"]
