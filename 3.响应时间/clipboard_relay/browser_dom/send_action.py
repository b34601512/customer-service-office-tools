#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

def click_send_button_or_enter(page: Any) -> str:
    # 该函数用于优先点击“发送”按钮，找不到时回退到回车发送。
    buttons = page.locator("button, [role='button']")
    count = int(buttons.count())
    best: tuple[Any, dict[str, float], float] | None = None
    for index in range(count):
        locator = buttons.nth(index)
        if not bool(locator.is_visible(timeout=300)):
            continue
        text = str(locator.inner_text(timeout=300) or "").strip()
        aria = str(locator.get_attribute("aria-label", timeout=300) or "").strip()
        title = str(locator.get_attribute("title", timeout=300) or "").strip()
        if "发送" not in f"{text} {aria} {title}":
            continue
        box = locator.bounding_box(timeout=300) or {}
        score = float(box.get("y") or 0) * 10 + float(box.get("x") or 0)
        if best is None or score > best[2]:
            best = (locator, box, score)
    if best is not None:
        best[0].click(force=True, timeout=5000)
        return "button"
    page.keyboard.press("Enter")
    return "enter"

__all__ = ["click_send_button_or_enter"]
