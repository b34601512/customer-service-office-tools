# 该文件用于装配 ERP 浏览器控制器主类。
from __future__ import annotations

import queue
import threading
from pathlib import Path

from .launch import BrowserLaunchMixin
from .page_state import PageStateMixin
from .processes import BrowserProcessMixin
from .scan_orders import ScanOrdersMixin
from .thread_control import BrowserThreadMixin
from .types import BrowserCommand
from .wait_page import WaitOrderPageMixin


class ErpBrowser(BrowserThreadMixin, BrowserProcessMixin, BrowserLaunchMixin, WaitOrderPageMixin, ScanOrdersMixin, PageStateMixin):
    def __init__(self, *, profile_root: Path) -> None:
        # 该控制器把 Playwright 操作集中到一个线程，避免跨线程页面句柄导致黑箱崩溃。
        self.profile_root = Path(profile_root)
        self._commands: queue.Queue[BrowserCommand | None] = queue.Queue()
        self._ready = threading.Event()
        self._closed = threading.Event()
        self._startup_error: BaseException | None = None
        self._thread: threading.Thread | None = None


__all__ = ["ErpBrowser"]
