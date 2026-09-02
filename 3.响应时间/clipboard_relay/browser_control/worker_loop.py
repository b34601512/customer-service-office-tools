#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import time

from .logging_utils import _log_browser

def _worker_main(self) -> None:
    contexts: dict[str, Any] = {}
    pages: dict[str, Any] = {}
    target_keys_by_name: dict[str, str] = {}
    playwright = None
    started_at = time.monotonic()
    try:
        _log_browser("加载Playwright模块", "_worker_main.import_start")
        import_started_at = time.monotonic()
        from playwright.sync_api import sync_playwright

        _log_browser("Playwright模块已加载", "_worker_main.import_done", elapsed_sec=round(time.monotonic() - import_started_at, 3))
        playwright_started_at = time.monotonic()
        playwright = sync_playwright().start()
        _log_browser("Playwright驱动已就绪", "_worker_main.playwright_ready", elapsed_sec=round(time.monotonic() - playwright_started_at, 3))
        self._ready.set()
        _log_browser("控制线程已就绪", "_worker_main.ready", elapsed_sec=round(time.monotonic() - started_at, 3))
        while True:
            command = self._commands.get()
            if command is None:
                self._close_contexts(contexts)
                return
            try:
                if command.name == "open_page":
                    command.result = self._do_open_page(playwright, contexts, pages, target_keys_by_name, *command.args, wait=False)
                elif command.name == "probe_login_page":
                    command.result = self._do_probe_login_page(pages, *command.args)
                elif command.name == "open_and_wait":
                    command.result = self._do_open_and_wait(playwright, contexts, pages, target_keys_by_name, *command.args)
                elif command.name == "send_text":
                    command.result = self._do_send_text(pages, target_keys_by_name, *command.args)
                elif command.name == "close_all":
                    command.result = self._close_contexts(contexts)
                    pages.clear()
                    target_keys_by_name.clear()
                else:
                    raise RuntimeError(f"未知浏览器控制命令：{command.name}")
            except BaseException as exc:
                command.error = exc
            finally:
                command.done.set()
    except BaseException as exc:
        self._startup_error = exc
        _log_browser("控制线程启动失败", "_worker_main.failed", elapsed_sec=round(time.monotonic() - started_at, 3), reason=str(exc))
        self._ready.set()
    finally:
        self._close_contexts(contexts)
        if playwright is not None:
            playwright.stop()
        self._closed.set()

__all__ = ["_worker_main"]
