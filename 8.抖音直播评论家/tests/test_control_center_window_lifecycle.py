#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from douyin_commenter import control_center_window_lifecycle as lifecycle
from douyin_commenter.server import _open_control_center_browser


class _FakeService:
    def __init__(self) -> None:
        self.shutdown_event = threading.Event()
        self.logs: list[str] = []
        self.exit_count = 0

    def _append_log(self, message: str) -> None:
        self.logs.append(str(message))

    def exit_all(self) -> None:
        self.exit_count += 1


class ControlCenterWindowLifecycleTest(unittest.TestCase):
    def test_watchdog_command_is_python_with_fixed_pids(self) -> None:
        command = lifecycle._build_cleanup_watchdog_command(  # noqa: SLF001
            parent_pid=100,
            control_browser_pid=200,
            shutdown_url="http://127.0.0.1:39420/api/control/exit",
        )

        self.assertEqual(command[command.index("--parent-pid") + 1], "100")
        self.assertEqual(command[command.index("--control-browser-pid") + 1], "200")
        self.assertNotIn("powershell", " ".join(command).lower())
        self.assertNotIn("encodedcommand", " ".join(command).lower())

    def test_monitor_uses_recorded_browser_pid(self) -> None:
        service = _FakeService()
        handle = lifecycle.ControlCenterBrowserHandle(Path("D:/demo/control_center"), 200)

        with (
            patch.object(lifecycle, "_MONITOR_INTERVAL_SECONDS", 0),
            patch.object(lifecycle, "is_process_running", side_effect=[True, False]),
        ):
            lifecycle._monitor_control_center_window(service=service, browser_handle=handle, stop_event=threading.Event())  # noqa: SLF001

        self.assertEqual(service.exit_count, 1)
        self.assertIn("检测到后台网页窗口已关闭", service.logs[-1])

    def test_server_passes_spawned_browser_pid_to_watchdog(self) -> None:
        service = Mock()
        service.get_config.return_value.browser.executable_path = ""
        process = Mock(pid=4321)

        with tempfile.TemporaryDirectory() as temp_dir:
            root_dir = Path(temp_dir)
            with (
                patch("douyin_commenter.server.resolve_browser_executable", return_value="chrome.exe"),
                patch("douyin_commenter.server.close_browser_processes_by_profile"),
                patch("douyin_commenter.server.subprocess.Popen", return_value=process),
                patch("douyin_commenter.server.start_control_center_cleanup_watchdog") as start_watchdog,
            ):
                handle = _open_control_center_browser(service=service, root_dir=root_dir, url="http://127.0.0.1:39420")

        self.assertEqual(handle.process_id, 4321)
        start_watchdog.assert_called_once_with(handle, shutdown_url="http://127.0.0.1:39420/api/control/exit")


if __name__ == "__main__":
    unittest.main()
