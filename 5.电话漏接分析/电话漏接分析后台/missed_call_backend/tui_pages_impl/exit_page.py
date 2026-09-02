"""TUI 退出页：提供可见的退出入口，按 0 或回车退出。"""
from __future__ import annotations

from typing import Any

from ..cli_display import colorize
from ..tui_app import Page


class ExitPage(Page):
    key = "9"
    title = "退出"

    def render(self, app: Any) -> list[str]:
        return [
            colorize("退出电话漏接分析", "brightYellow"),
            "",
            colorize("0  退出", "brightYellow"),
            "",
            colorize("按 0 或回车退出，按 ← → 可返回其它页面。", "muted"),
        ]

    def handle_key(self, key: str, app: Any) -> bool:
        if key in ("enter", "0", "y", "Y"):
            app.running = False
            return True
        if key in ("esc", "q", "backspace"):
            app.switch_page(0)
            return True
        return False

    def footer(self, app: Any) -> str:
        return "0/回车退出  Esc返回首页  ←→切页"
