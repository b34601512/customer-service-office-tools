#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

_NOISE_TITLE_PREFIXES = ("loading", "about:blank")


def _title_looks_like_navigation_noise(title: str) -> bool:
    # 该函数用于排除浏览器跳转页标题，避免链接里的关键词被误判成业务页面。
    text = str(title or "").strip()
    if not text:
        return False
    lowered = text.lower()
    if "http://" in lowered or "https://" in lowered:
        return True
    return any(lowered == prefix or lowered.startswith(f"{prefix} ") for prefix in _NOISE_TITLE_PREFIXES)


def _display_title_text(title: str) -> str:
    # 该函数用于把机器标题转成用户可读短文案，避免长链接撑坏首页。
    text = str(title or "").strip()
    if not text:
        return "空"
    if _title_looks_like_navigation_noise(text):
        return "页面加载中"
    if len(text) > 60:
        return f"{text[:57]}..."
    return text


def _title_matches(title: str, keywords: tuple[str, ...]) -> bool:
    # 该函数用于按标题关键字判断页面是否进入目标业务页。
    text = str(title or "").strip()
    if not text:
        return False
    if _title_looks_like_navigation_noise(text):
        return False
    for keyword in keywords:
        value = str(keyword or "").strip()
        if not value:
            continue
        if value.startswith("=") and text == value[1:].strip():
            return True
        if not value.startswith("=") and value in text:
            return True
    return False


def _is_browser_already_closed_error(exc: BaseException) -> bool:
    # 该函数用于识别用户手动关闭浏览器后的 Playwright 关闭错误，让重新打开保持幂等。
    error_name = exc.__class__.__name__.lower()
    message = str(exc or "").lower()
    return (
        "targetclosed" in error_name
        or "target page, context or browser has been closed" in message
        or "context or browser has been closed" in message
        or "browser has been closed" in message
    )

__all__ = ["_display_title_text", "_title_looks_like_navigation_noise", "_title_matches", "_is_browser_already_closed_error"]
