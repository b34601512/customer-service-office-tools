# 该文件用于提供 ERP 浏览器脚本测试的共享浏览器夹具。
from __future__ import annotations

import unittest

from refund_reminder.browser_resolver import resolve_browser_executable
from refund_reminder.erp_scripts import SCAN_VISIBLE_ORDER_ROWS_SCRIPT


class ErpScriptBrowserCase(unittest.TestCase):
    _playwright = None
    _browser = None

    @classmethod
    def setUpClass(cls) -> None:
        # 该测试类复用同一个浏览器进程，避免每个用例反复启动浏览器拖慢全量验证。
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:
            raise unittest.SkipTest(f"未安装 Playwright，跳过浏览器脚本测试：{exc}") from exc
        try:
            executable = resolve_browser_executable("")
        except Exception as exc:
            raise unittest.SkipTest(f"未找到 Chrome/Edge，跳过浏览器脚本测试：{exc}") from exc

        cls._playwright = sync_playwright().start()
        try:
            cls._browser = cls._playwright.chromium.launch(executable_path=executable, headless=True)
        except Exception:
            cls._playwright.stop()
            cls._playwright = None
            raise

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._browser is not None:
            cls._browser.close()
            cls._browser = None
        if cls._playwright is not None:
            cls._playwright.stop()
            cls._playwright = None

    def _evaluate_script(self, html: str, script: str, config: dict) -> dict:
        # 该函数用于在真实浏览器里验证页面脚本，避免只测字符串拼接。
        if self._browser is None:
            raise RuntimeError("浏览器脚本测试失败：浏览器未初始化")
        page = self._browser.new_page()
        try:
            page.set_content(html)
            return page.evaluate(script, config)
        finally:
            page.close()

    def _run_visible_order_rows_script(self, html: str) -> dict:
        # 该函数用于验证扫描脚本只读取可见订单行。
        return self._evaluate_script(
            html,
            SCAN_VISIBLE_ORDER_ROWS_SCRIPT,
            {"order_row_column_names": ["平台单号"]},
        )

