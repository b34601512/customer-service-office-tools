#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations


def _is_navigation_context_error(exc: BaseException) -> bool:
    # 该函数用于识别点击后页面跳转导致的上下文销毁，这类现象应转入状态等待。
    text = str(exc or "").lower()
    markers = (
        "execution context was destroyed",
        "most likely because of a navigation",
        "frame was detached",
        "cannot find context with specified id",
    )
    return any(marker in text for marker in markers)


def _is_locator_timeout_error(exc: BaseException) -> bool:
    # 该函数用于识别控件坐标等待超时，后续排障时能直接看出是页面控件未就绪。
    text = str(exc or "").lower()
    return "locator.bounding_box" in text and "timeout" in text


__all__ = ["_is_locator_timeout_error", "_is_navigation_context_error"]
