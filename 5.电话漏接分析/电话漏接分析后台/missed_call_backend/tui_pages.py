"""电话漏接分析 TUI 页面聚合入口。

实际页面按业务拆分到 tui_pages 子包，这里只做统一导出。
"""
from __future__ import annotations

from .tui_pages_impl.pages import create_pages

__all__ = ["create_pages"]
