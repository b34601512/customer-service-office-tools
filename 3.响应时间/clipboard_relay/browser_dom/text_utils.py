#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

def normalize_editor_text(value: str) -> str:
    # 该函数用于统一校验编辑器回读文本，避免零宽字符和换行差异误判。
    return str(value or "").replace("\u200b", "").replace("\u00a0", " ").replace("\r\n", "\n").strip()


def _preview_text(text: str, *, limit: int = 48) -> str:
    # 该函数用于裁剪日志里的文本预览，避免超长内容把排障日志淹没。
    value = normalize_editor_text(text)
    if len(value) <= limit:
        return value
    return f"{value[:limit]}...(共{len(value)}字)"

__all__ = ["normalize_editor_text", "_preview_text"]
