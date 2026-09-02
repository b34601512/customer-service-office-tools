#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path
import unittest

from clipboard_relay.browser_control import BrowserControl
from clipboard_relay.config import CredentialConfig, LoginFlowConfig


def _login_flow() -> LoginFlowConfig:
    # 测试只验证控制线程状态机，不需要真实浏览器路径。
    return LoginFlowConfig(
        enabled=True,
        open_urls_in_new_window=True,
        login_wait_timeout_sec=600,
        login_poll_interval_sec=1,
        auto_start_on_panel_open=False,
        browser_executable="",
    )


class _FakeReadyEvent:
    def __init__(self, responses: list[bool]) -> None:
        self.responses = list(responses)
        self.wait_timeouts: list[float | None] = []

    def wait(self, timeout: float | None = None) -> bool:
        self.wait_timeouts.append(timeout)
        if not self.responses:
            return True
        return self.responses.pop(0)


class _AliveThread:
    def is_alive(self) -> bool:
        return True


class _FailingBrowserControl(BrowserControl):
    def _worker_main(self) -> None:
        self._startup_error = RuntimeError("模拟 Playwright 启动失败")
        self._ready.set()
        self._closed.set()


class _AlreadyClosedContext:
    def close(self) -> None:
        raise RuntimeError("BrowserContext.close: Target page, context or browser has been closed")


class _BrokenContext:
    def close(self) -> None:
        raise RuntimeError("磁盘权限异常")


class BrowserControlTests(unittest.TestCase):
    def test_account_profile_key_isolated_by_username_without_leaking_name(self) -> None:
        first = BrowserControl._account_profile_key(CredentialConfig(username="客服账号A", password="same"))
        second = BrowserControl._account_profile_key(CredentialConfig(username="客服账号B", password="same"))

        self.assertNotEqual(first, second)
        self.assertEqual(BrowserControl._account_profile_key(CredentialConfig(username="", password="")), "manual")
        self.assertNotIn("客服账号A", first)

    def test_startup_waits_for_ready_state_without_hard_timeout(self) -> None:
        control = BrowserControl(profile_root=Path("runtime/browser_profiles"), login_flow=_login_flow())
        ready = _FakeReadyEvent([False, False, True])
        control._ready = ready  # type: ignore[assignment]
        control._thread = _AliveThread()  # type: ignore[assignment]

        control._wait_until_worker_ready()

        self.assertEqual(ready.wait_timeouts, [0.2, 0.2, 0.2])
        self.assertNotIn(15, ready.wait_timeouts)

    def test_startup_failure_reports_original_reason(self) -> None:
        control = _FailingBrowserControl(profile_root=Path("runtime/browser_profiles"), login_flow=_login_flow())

        with self.assertRaisesRegex(RuntimeError, "模拟 Playwright 启动失败"):
            control.start()

    def test_close_target_allows_reopen_after_user_manually_closed_browser(self) -> None:
        control = BrowserControl(profile_root=Path("runtime/browser_profiles"), login_flow=_login_flow())
        contexts = {"jd_service": _AlreadyClosedContext()}
        pages = {"jd_service": object()}
        target_keys_by_name = {"咚咚客服端": "jd_service"}

        control._close_target(contexts, pages, target_keys_by_name, "jd_service")

        self.assertEqual(contexts, {})
        self.assertEqual(pages, {})
        self.assertEqual(target_keys_by_name, {})

    def test_close_target_still_raises_unknown_close_error(self) -> None:
        control = BrowserControl(profile_root=Path("runtime/browser_profiles"), login_flow=_login_flow())

        with self.assertRaisesRegex(RuntimeError, "磁盘权限异常"):
            control._close_target({"jd_service": _BrokenContext()}, {}, {}, "jd_service")


if __name__ == "__main__":
    unittest.main()
