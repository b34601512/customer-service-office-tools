#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from clipboard_relay.runtime_paths import get_web_root
from clipboard_relay.web_control.server import _build_control_center_browser_args, _build_static_assets, _is_expected_client_disconnect, _open_control_center_browser


class _FakeService:
    def __init__(self) -> None:
        # 该对象用于测试后台浏览器启动，不需要创建真实 ControlCenterService。
        self.config = Mock()
        self.config.login_flow = Mock()
        self.logs: list[str] = []

    def _append_log(self, message: str) -> None:
        self.logs.append(str(message))


class WebControlServerTests(unittest.TestCase):
    def test_control_center_browser_args_use_dedicated_profile(self) -> None:
        args = _build_control_center_browser_args(
            executable=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            user_data_dir=Path(r"E:\Personal\codex\响应时间\runtime\browser_profiles\control_center"),
            url="http://127.0.0.1:39390",
        )
        self.assertEqual(args[0], r"C:\Program Files\Google\Chrome\Application\chrome.exe")
        self.assertIn("--new-window", args)
        self.assertIn("--no-default-browser-check", args)
        self.assertIn("--disable-session-crashed-bubble", args)
        self.assertIn("--user-data-dir=E:\\Personal\\codex\\响应时间\\runtime\\browser_profiles\\control_center", args)
        self.assertEqual(args[-1], "http://127.0.0.1:39390")

    def test_expected_disconnects_are_treated_as_normal_shutdown(self) -> None:
        self.assertTrue(_is_expected_client_disconnect(ConnectionAbortedError(10053, "你的主机中的软件中止了一个已建立的连接。")))
        self.assertTrue(_is_expected_client_disconnect(BrokenPipeError()))
        self.assertFalse(_is_expected_client_disconnect(RuntimeError("不是断连")))

    def test_static_assets_include_split_pages(self) -> None:
        assets = _build_static_assets(get_web_root())
        self.assertIn("/", assets)
        self.assertIn("/config", assets)
        self.assertIn("/logs", assets)
        home_html = assets["/"][1].decode("utf-8")
        config_html = assets["/config"][1].decode("utf-8")
        self.assertIn("响应时间后台", home_html)
        self.assertNotIn("网页控制中心", home_html)
        self.assertIn("configPanel", home_html)
        self.assertEqual(config_html, home_html)
        self.assertNotIn("配置中心", config_html)
        self.assertIn("日志中心", assets["/logs"][1].decode("utf-8"))

    def test_open_control_center_browser_passes_recorded_pid_to_watchdog(self) -> None:
        # 该测试用于确认后台窗口生命周期管理拿到本次启动 PID，而不是再靠常态全系统扫描识别。
        service = _FakeService()
        process = Mock()
        process.pid = 4321

        with (
            patch("clipboard_relay.web_control.server.resolve_browser_executable", return_value="chrome.exe"),
            patch("clipboard_relay.web_control.server.close_browser_processes_by_profile") as close_profile,
            patch("clipboard_relay.web_control.server.subprocess.Popen", return_value=process),
            patch("clipboard_relay.web_control.server.start_control_center_cleanup_watchdog") as start_watchdog,
        ):
            handle = _open_control_center_browser(service=service, root_dir=Path("D:/demo"), url="http://127.0.0.1:39390")

        self.assertEqual(handle.process_id, 4321)
        self.assertEqual(handle.profile_dir, Path("D:/demo/runtime/browser_profiles/control_center"))
        close_profile.assert_called_once_with(handle.profile_dir)
        start_watchdog.assert_called_once_with(handle, shutdown_url="http://127.0.0.1:39390/api/control/exit")
        self.assertIs(start_watchdog.call_args.args[0], handle)


if __name__ == "__main__":
    unittest.main()
