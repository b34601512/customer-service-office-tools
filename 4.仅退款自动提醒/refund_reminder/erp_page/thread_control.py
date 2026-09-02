# 该文件用于管理 Playwright 浏览器控制线程和命令分发。
from __future__ import annotations

import threading
from typing import Any, Callable

from ..config import AppConfig
from ..logger import log
from .constants import MODULE_NAME
from .types import BrowserCommand, BrowserPageState, ProblemOrderCallback, ScanSummary


class BrowserThreadMixin:
    def open_erp(self, config: AppConfig) -> BrowserPageState:
        # 该函数用于请求浏览器线程打开 ERP。
        return self._call("open_erp", config)

    def wait_order_page(self, config: AppConfig, status: Callable[[str], None] | None = None) -> BrowserPageState:
        # 该函数用于请求浏览器线程等待订单页。
        return self._call("wait_order_page", config, status)

    def scan_orders(self, config: AppConfig, status: Callable[[str], None] | None = None, on_problem_order: ProblemOrderCallback | None = None) -> ScanSummary:
        # 该函数用于请求浏览器线程扫描订单。
        return self._call("scan_orders", config, status, on_problem_order)

    def close_all(self) -> None:
        # 该函数用于关闭当前浏览器上下文。
        if self._thread is not None and self._thread.is_alive():
            self._call("close_all", timeout_sec=10)

    def stop(self) -> None:
        # 该函数用于停止浏览器控制线程。
        if self._thread is None:
            return
        if self._thread.is_alive():
            self._commands.put(None)
            self._closed.wait(timeout=10)
        self._thread = None

    def start(self, *, timeout_sec: float = 120.0) -> None:
        # 该函数用于懒启动浏览器线程，后台打开后不立即占用浏览器资源。
        wait_timeout_sec = max(10.0, float(timeout_sec))
        if self._thread is not None and self._thread.is_alive():
            self._wait_until_worker_ready(wait_timeout_sec, log_ready=not self._ready.is_set())
            return
        self._ready.clear()
        self._closed.clear()
        self._startup_error = None
        self._thread = threading.Thread(target=self._worker_main, name="erp-browser", daemon=True)
        log("Browser", "启动控制线程", MODULE_NAME, "start", timeout_sec=wait_timeout_sec)
        self._thread.start()
        self._wait_until_worker_ready(wait_timeout_sec, log_ready=True)

    def _wait_until_worker_ready(self, timeout_sec: float, *, log_ready: bool) -> None:
        # 该函数只等浏览器控制线程的就绪状态，避免慢电脑被固定 15 秒误判失败。
        if not self._ready.wait(timeout=timeout_sec):
            log("Browser", "启动控制线程", MODULE_NAME, "_wait_until_worker_ready.timeout", timeout_sec=timeout_sec)
            raise RuntimeError(f"浏览器控制线程启动超时：已等待 {timeout_sec:g} 秒，Playwright 仍未就绪；请关闭残留受控浏览器后重试，或调大「浏览器启动等待秒」")
        if self._startup_error is not None:
            raise RuntimeError(f"浏览器控制线程启动失败：{self._startup_error}") from self._startup_error
        if log_ready:
            log("Browser", "启动控制线程", MODULE_NAME, "_wait_until_worker_ready.ready", timeout_sec=timeout_sec)

    def _call(self, name: str, *args: Any, timeout_sec: float | None = None) -> Any:
        # 该函数把跨线程命令投递给唯一浏览器线程并同步等待结果。
        self.start(timeout_sec=self._browser_start_timeout_sec(args))
        command = BrowserCommand(name=name, args=tuple(args), done=threading.Event())
        self._commands.put(command)
        completed = command.done.wait(timeout=None if timeout_sec is None else max(0.1, float(timeout_sec)))
        if not completed:
            raise RuntimeError(f"浏览器控制命令超时：{name}")
        if command.error is not None:
            raise command.error
        return command.result

    @staticmethod
    def _browser_start_timeout_sec(args: tuple[Any, ...]) -> float:
        # 该函数从命令参数里提取浏览器启动等待配置，避免启动链路再出现隐藏硬编码。
        for item in args:
            if isinstance(item, AppConfig):
                return max(10.0, float(item.login.browser_start_timeout_sec))
        return 120.0

    def _worker_main(self) -> None:
        # 该函数运行在唯一浏览器线程内，集中分发 Playwright 页面动作。
        playwright = None
        context = None
        page = None
        user_data_dir = None
        try:
            from playwright.sync_api import sync_playwright

            playwright = sync_playwright().start()
            self._ready.set()
            while True:
                command = self._commands.get()
                if command is None:
                    return
                try:
                    if command.name == "open_erp":
                        context, page, user_data_dir = self._do_open_erp(playwright, context, command.args[0])
                        command.result = self._page_state(page, user_data_dir)
                    elif command.name == "wait_order_page":
                        command.result = self._do_wait_order_page(page, user_data_dir, *command.args)
                    elif command.name == "scan_orders":
                        command.result = self._do_scan_orders(page, user_data_dir, *command.args)
                    elif command.name == "close_all":
                        if context is not None:
                            context.close()
                        context = page = user_data_dir = None
                    else:
                        raise RuntimeError(f"未知浏览器控制命令：{command.name}")
                except BaseException as exc:
                    command.error = exc
                finally:
                    command.done.set()
        except BaseException as exc:
            self._startup_error = exc
            self._ready.set()
        finally:
            if context is not None:
                context.close()
            if playwright is not None:
                playwright.stop()
            self._closed.set()


__all__ = ["BrowserThreadMixin"]
