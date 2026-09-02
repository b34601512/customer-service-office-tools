#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from clipboard_relay.web_control import control_center_window_lifecycle as lifecycle


class _FakeService:
    def __init__(self) -> None:
        # 该对象用于模拟后台服务，只记录窗口监控触发的用户可见动作。
        self.shutdown_event = threading.Event()
        self.logs: list[str] = []
        self.exit_count = 0

    def _append_log(self, message: str) -> None:
        self.logs.append(str(message))

    def exit_all(self) -> None:
        self.exit_count += 1


class ControlCenterWindowLifecycleTests(unittest.TestCase):
    def test_close_browser_processes_waits_until_profile_released(self) -> None:
        # 该测试用于确认启动清理前会等浏览器资料目录释放，避免 Windows 文件锁阻断启动。
        profile_path = Path("D:/demo/runtime/browser_profiles")
        calls: list[list[str]] = []

        def fake_find(_profile_paths) -> list[str]:
            return ["100", "200"] if len(calls) == 0 else []

        def fake_stop(process_ids: list[str]) -> list[str]:
            calls.append(list(process_ids))
            return list(process_ids)

        with (
            patch.object(lifecycle, "find_browser_process_ids_by_profiles", side_effect=fake_find),
            patch.object(lifecycle, "stop_process_ids", side_effect=fake_stop),
            patch.object(lifecycle.time, "sleep", return_value=None),
        ):
            lifecycle.close_browser_processes_by_profile(profile_path)

        self.assertEqual(calls, [["100", "200"]])

    def test_watchdog_command_reenters_python_with_fixed_pids(self) -> None:
        # 该测试用于锁定实现边界：外部看门狗必须重进 Python，不能再生成编码 PowerShell。
        command = lifecycle._build_cleanup_watchdog_command(  # noqa: SLF001
            parent_pid=100,
            control_browser_pid=200,
            shutdown_url="http://127.0.0.1:39390/api/control/exit",
        )

        self.assertIn("--control-center-cleanup-watchdog", command)
        self.assertEqual(command[command.index("--parent-pid") + 1], "100")
        self.assertEqual(command[command.index("--control-browser-pid") + 1], "200")
        self.assertNotIn("powershell", " ".join(command).lower())
        self.assertNotIn("encodedcommand", " ".join(command).lower())

    def test_watchdog_uses_only_recorded_pids(self) -> None:
        # 该测试用于确认窗口消失后先请求正常退出，再精确结束父进程和记录的浏览器树。
        browser_checks = iter([True, False, False])

        def fake_is_running(process_id: int) -> bool:
            if process_id == 100:
                return True
            return next(browser_checks)

        with (
            patch.object(lifecycle, "_MISSING_WINDOW_TICKS_BEFORE_EXIT", 2),
            patch.object(lifecycle, "_GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS", 0),
            patch.object(lifecycle, "_MONITOR_INTERVAL_SECONDS", 0),
            patch.object(lifecycle, "is_process_running", side_effect=fake_is_running),
            patch.object(lifecycle, "_request_graceful_shutdown") as request_shutdown,
            patch.object(lifecycle, "_terminate_process") as terminate_process,
            patch.object(lifecycle.time, "sleep", return_value=None),
        ):
            result = lifecycle.run_control_center_cleanup_watchdog(
                parent_pid=100,
                control_browser_pid=200,
                shutdown_url="http://127.0.0.1:39390/api/control/exit",
            )

        self.assertEqual(result, 0)
        request_shutdown.assert_called_once()
        self.assertEqual(
            terminate_process.call_args_list,
            [unittest.mock.call(100, include_children=False), unittest.mock.call(200, include_children=True)],
        )

    def test_monitor_exits_after_recorded_browser_pid_disappears(self) -> None:
        # 该测试用于确认后台窗口监控只依据记录 PID 触发退出，不依赖资料目录扫描。
        service = _FakeService()
        handle = lifecycle.ControlCenterBrowserHandle(profile_dir=Path("D:/demo/runtime/browser_profiles/control_center"), process_id=200)

        with (
            patch.object(lifecycle, "_MONITOR_INTERVAL_SECONDS", 0),
            patch.object(lifecycle, "_MISSING_WINDOW_TICKS_BEFORE_EXIT", 2),
            patch.object(lifecycle, "_is_control_center_browser_running", side_effect=[True, False, False]),
        ):
            lifecycle._monitor_control_center_window(service=service, browser_handle=handle, stop_event=threading.Event())  # noqa: SLF001

        self.assertEqual(service.exit_count, 1)
        self.assertIn("检测到后台网页窗口已关闭", service.logs[-1])


if __name__ == "__main__":
    unittest.main()
