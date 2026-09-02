# 该文件用于打开独立资料目录的 ERP 浏览器。
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..browser_resolver import resolve_browser_executable
from ..config import AppConfig
from ..logger import log
from ..runtime_maintenance import browser_runtime_arguments, clean_browser_profile_cache
from .constants import MODULE_NAME


class BrowserLaunchMixin:
    def _do_open_erp(self, playwright: Any, old_context: Any, config: AppConfig) -> tuple[Any, Any, Path]:
        # 该函数用于打开独立资料目录的 ERP 浏览器，保留登录态但隔离不同工具数据。
        if old_context is not None:
            old_context.close()
        executable = resolve_browser_executable(config.login.browser_executable)
        user_data_dir = self.profile_root / Path(executable).stem.lower() / "erp"
        user_data_dir.mkdir(parents=True, exist_ok=True)
        self._close_stale_profile_processes(user_data_dir)
        clean_browser_profile_cache(user_data_dir)
        log("Browser", "启动ERP浏览器", MODULE_NAME, "_do_open_erp.launch", executable=executable, profile=str(user_data_dir), url=config.login.erp_url)
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(user_data_dir),
            executable_path=executable,
            headless=False,
            viewport={"width": 1500, "height": 920},
            locale="zh-CN",
            accept_downloads=True,
            args=browser_runtime_arguments("--disable-blink-features=AutomationControlled", "--no-default-browser-check", "--disable-popup-blocking"),
        )
        context.set_default_timeout(10000)
        page = context.pages[0] if context.pages else context.new_page()
        page_load_timeout_ms = int(max(10.0, float(config.login.page_load_timeout_sec)) * 1000)
        page.goto(config.login.erp_url, wait_until="domcontentloaded", timeout=page_load_timeout_ms)
        log("Browser", "ERP页面已打开", MODULE_NAME, "_do_open_erp.opened", title=self._safe_page_title(page), url=self._safe_page_url(page))
        return context, page, user_data_dir


__all__ = ["BrowserLaunchMixin"]
