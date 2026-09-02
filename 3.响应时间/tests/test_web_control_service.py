#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from clipboard_relay.browser_control import BrowserLoginProbe, BrowserPageState
from clipboard_relay.login_dom import LoginFillResult
from clipboard_relay.web_control.service import ControlCenterService


def _format_expected_number(value: float | int) -> str:
    # 该函数用于按网页表单的展示规则生成断言值，避免默认配置改了以后测试还卡在旧数字上。
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return str(value)


def _format_expected_numbers(*values: float | int) -> str:
    # 该函数用于统一生成多值表单字段的期望文本。
    return ",".join(_format_expected_number(item) for item in values)


class _TestControlCenterService(ControlCenterService):
    def _start_hotkey_watcher(self) -> None:
        # 测试环境不启动全局热键线程，避免给系统键盘状态引入噪声。
        return

    def _start_runtime_maintenance_watcher(self) -> None:
        # 测试环境不启动运行体检线程，避免后台清理影响断言时序。
        return


class _ImmediateManualWatchService(_TestControlCenterService):
    def _start_manual_login_watch(self, spec, token: int) -> None:
        # 测试环境直接同步跑检测，避免后台线程让断言时序变脆。
        self._watch_manual_login_target(spec, token)


class _NoopManualWatchService(_TestControlCenterService):
    def _start_manual_login_watch(self, spec, token: int) -> None:
        # 该测试只关心打开链接，不启动登录轮询。
        return


class WebControlServiceTests(unittest.TestCase):
    def _make_service(self, service_cls: type[_TestControlCenterService] = _TestControlCenterService) -> _TestControlCenterService:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        config_path = Path(temp_dir.name) / "config.json"
        shutil.copyfile(Path(__file__).resolve().parents[1] / "config.json", config_path)
        service = service_cls(config_path=config_path)
        self.addCleanup(service.shutdown_event.set)
        return service

    def test_form_state_uses_integer_strings_for_integer_defaults(self) -> None:
        service = self._make_service()
        form = service.get_form_state()
        self.assertEqual(form["service_delay"], _format_expected_number(service.config.jd_service.send_delay_sec))
        self.assertEqual(
            form["service_random_delay"],
            _format_expected_numbers(
                service.config.jd_service.send_delay_random_min_sec,
                service.config.jd_service.send_delay_random_max_sec,
            ),
        )
        self.assertEqual(form["login_timeout"], _format_expected_number(service.config.login_flow.login_wait_timeout_sec))
        self.assertEqual(
            form["work_rest"],
            _format_expected_numbers(service.config.work_duration_sec, service.config.rest_duration_sec),
        )

    def test_save_form_updates_credentials_and_snapshot(self) -> None:
        service = self._make_service()
        payload = dict(service.get_form_state())
        payload["service_username"] = "demo_service"
        payload["service_password"] = "service_pwd"
        payload["web_username"] = "demo_web"
        payload["web_password"] = "web_pwd"
        payload["rounds"] = "12"

        service.save_form(payload)
        snapshot = service.get_snapshot()

        self.assertEqual(snapshot["form"]["service_username"], "demo_service")
        self.assertEqual(snapshot["form"]["web_username"], "demo_web")
        self.assertEqual(snapshot["runtime"]["totalRounds"], 12)
        self.assertIn("已配置咚咚客服端账号密码", snapshot["runtime"]["indicators"]["service"]["detail"])
        self.assertIn("已配置买家客户端账号密码", snapshot["runtime"]["indicators"]["web"]["detail"])

    def test_save_form_keeps_multiple_buyer_urls_and_opens_selected_one(self) -> None:
        service = self._make_service(_NoopManualWatchService)
        payload = dict(service.get_form_state())
        payload["jd_url"] = "https://shop-b.example"
        payload["jd_urls"] = "https://shop-a.example\nhttps://shop-b.example\nhttps://shop-c.example"
        payload["jd_url_entries"] = [
            {"url": "https://shop-a.example", "note": "A店"},
            {"url": "https://shop-b.example", "note": "B店"},
            {"url": "", "note": "待补网址店"},
            {"url": "https://shop-c.example", "note": "C店"},
        ]
        service.save_form(payload)
        form = service.get_form_state()
        self.assertEqual(form["jd_url"], "https://shop-b.example")
        self.assertEqual(form["jd_url_options"], ["https://shop-a.example", "https://shop-b.example", "https://shop-c.example"])
        self.assertEqual(form["jd_url_entries"][1]["note"], "B店")
        self.assertEqual(form["jd_url_entries"][2]["note"], "待补网址店")
        self.assertEqual(form["jd_url_entries"][2]["url"], "")
        self.assertIn("https://shop-c.example", form["jd_urls"])

        class FakeLoginBrowser:
            def __init__(self) -> None:
                self.opened_url = ""

            def update_login_flow(self, _login_flow) -> None:
                return

            def open_page(self, *, target_key, target, credentials, url):
                self.opened_url = str(url)
                return BrowserPageState(
                    target_key=str(target_key),
                    target_name=str(target.name),
                    title="登录页",
                    url=str(url),
                    user_data_dir=Path(f"C:/fake/{target_key}"),
                )

        browser = FakeLoginBrowser()
        service.browser = browser  # type: ignore[assignment]
        service.open_login_target("web")
        self.assertEqual(browser.opened_url, "https://shop-b.example")

    def test_save_buyer_urls_keeps_note_only_entry_without_validating_other_fields(self) -> None:
        service = self._make_service(_NoopManualWatchService)

        service.save_buyer_urls(
            {
                "jd_url": "https://shop-a.example",
                "jd_urls": "https://shop-a.example",
                "jd_url_entries": [
                    {"url": "https://shop-a.example", "note": "A店"},
                    {"url": "", "note": "待补网址店"},
                ],
            }
        )

        form = service.get_form_state()
        self.assertEqual(form["jd_url"], "https://shop-a.example")
        self.assertEqual(form["jd_urls"], "https://shop-a.example")
        self.assertEqual(form["jd_url_entries"][1], {"url": "", "note": "待补网址店"})

    def test_save_credentials_keeps_multiple_accounts_without_validating_other_fields(self) -> None:
        service = self._make_service(_NoopManualWatchService)

        service.save_credentials(
            {
                "service_username": "service-b",
                "service_password": "service-pass-b",
                "service_credential_entries": [
                    {"username": "service-a", "password": "service-pass-a", "note": "京东6店"},
                    {"username": "service-b", "password": "service-pass-b", "note": "京东3店"},
                    {"username": "", "password": "", "note": "待补账号店"},
                ],
                "web_username": "web-b",
                "web_password": "web-pass-b",
                "web_credential_entries": [
                    {"username": "web-b", "password": "web-pass-b", "note": "买家3店"},
                ],
            }
        )

        form = service.get_form_state()
        self.assertEqual(form["service_username"], "service-b")
        self.assertEqual(form["service_password"], "service-pass-b")
        self.assertEqual(form["service_credential_entries"][1]["note"], "京东3店")
        self.assertEqual(form["service_credential_entries"][2], {"username": "", "password": "", "note": "待补账号店"})
        self.assertEqual(form["web_credential_entries"][0]["note"], "买家3店")
        self.assertIn("已配置咚咚客服端账号密码", service.indicators["service"]["detail"])
        self.assertIn("网页登录账号信息已保存", service.log_lines[-1])

    def test_open_login_target_uses_selected_service_account(self) -> None:
        service = self._make_service(_NoopManualWatchService)
        service.save_credentials(
            {
                "service_username": "service-b",
                "service_password": "service-pass-b",
                "service_credential_entries": [
                    {"username": "service-a", "password": "service-pass-a", "note": "京东6店"},
                    {"username": "service-b", "password": "service-pass-b", "note": "京东3店"},
                ],
                "web_username": "",
                "web_password": "",
                "web_credential_entries": [],
            }
        )

        class CaptureCredentialBrowser:
            def __init__(self) -> None:
                self.opened_username = ""

            def update_login_flow(self, _login_flow) -> None:
                return

            def open_page(self, *, target_key, target, credentials, url):
                self.opened_username = str(credentials.username)
                return BrowserPageState(
                    target_key=str(target_key),
                    target_name=str(target.name),
                    title="登录页",
                    url=str(url),
                    user_data_dir=Path(f"C:/fake/{target_key}"),
                )

        browser = CaptureCredentialBrowser()
        service.browser = browser  # type: ignore[assignment]

        service.open_login_target("service")

        self.assertEqual(browser.opened_username, "service-b")

    def test_pause_and_stop_are_ignored_before_main_flow_starts(self) -> None:
        service = self._make_service()

        service.pause_resume()
        service.stop_all()
        events = service.panel_hotkeys.poll()

        self.assertFalse(events.pause_resume)
        self.assertFalse(events.stop)
        self.assertFalse(service.stop_event.is_set())
        self.assertEqual(service.status_phase, "待命")
        self.assertIn("已忽略暂停/继续请求", "\n".join(service.log_lines))
        self.assertIn("已忽略停止请求", "\n".join(service.log_lines))

    def test_exit_worker_uses_direct_force_cleanup(self) -> None:
        service = self._make_service()

        class ForceOnlyBrowser:
            def __init__(self) -> None:
                self.force_killed = False

            def force_kill_managed_browsers(self) -> None:
                self.force_killed = True

        browser = ForceOnlyBrowser()
        service.browser = browser  # type: ignore[assignment]

        service._exit_worker()

        self.assertTrue(service.shutdown_event.is_set())
        self.assertTrue(browser.force_killed)
        self.assertIn("退出流程改为直接强制清理", service.log_lines[-2])
        self.assertIn("已关闭本工具打开的网页。", service.log_lines[-1])

    def test_manual_login_buttons_can_drive_single_page_login_until_ready(self) -> None:
        service = self._make_service(_ImmediateManualWatchService)

        class FakeLoginBrowser:
            def __init__(self) -> None:
                self.opened_targets: list[str] = []

            def update_login_flow(self, _login_flow) -> None:
                return

            def open_page(self, *, target_key, target, credentials, url):
                self.opened_targets.append(str(target_key))
                return BrowserPageState(
                    target_key=str(target_key),
                    target_name=str(target.name),
                    title="登录页",
                    url=str(url),
                    user_data_dir=Path(f"C:/fake/{target_key}"),
                )

            def probe_login_page(self, *, target_key, target, credentials, allow_click_login_entry):
                keyword = str(target.title_keywords[0]).lstrip("=")
                filled = bool(credentials.username and credentials.password)
                detail = (
                    f"{target.name} 账号密码已自动填入，请完成滑块/验证码后手动点击登录。"
                    if filled
                    else f"{target.name} 未配置账号密码，将等待人工输入。"
                )
                return BrowserLoginProbe(
                    page_state=BrowserPageState(
                        target_key=str(target_key),
                        target_name=str(target.name),
                        title=keyword,
                        url=f"https://example.com/{target_key}",
                        user_data_dir=Path(f"C:/fake/{target_key}"),
                    ),
                    title_matched=True,
                    fill_result=LoginFillResult(clicked_login_entry=bool(allow_click_login_entry), filled=filled, detail=detail),
                )

        service.browser = FakeLoginBrowser()  # type: ignore[assignment]

        first_title = service.open_login_target("service")
        self.assertEqual(first_title, "咚咚客服端")
        self.assertEqual(service.indicators["service"]["state"], "ok")
        self.assertEqual(service.indicators["browser"]["state"], "running")
        self.assertFalse(service.ready)

        second_title = service.open_login_target("web")
        self.assertEqual(second_title, "买家客户端")
        self.assertEqual(service.indicators["web"]["state"], "ok")
        self.assertEqual(service.indicators["browser"]["state"], "ok")
        self.assertEqual(service.status_phase, "就绪")
        self.assertTrue(service.ready)
        self.assertIn("已打开咚咚客服端登录页", "\n".join(service.log_lines))
        self.assertIn("两个网页都已就绪", service.log_lines[-1])

    def test_save_form_does_not_reset_other_logged_in_indicator(self) -> None:
        service = self._make_service(_ImmediateManualWatchService)

        class FakeLoginBrowser:
            def update_login_flow(self, _login_flow) -> None:
                return

            def open_page(self, *, target_key, target, credentials, url):
                return BrowserPageState(
                    target_key=str(target_key),
                    target_name=str(target.name),
                    title="登录页",
                    url=str(url),
                    user_data_dir=Path(f"C:/fake/{target_key}"),
                )

            def probe_login_page(self, *, target_key, target, credentials, allow_click_login_entry):
                keyword = str(target.title_keywords[0]).lstrip("=")
                return BrowserLoginProbe(
                    page_state=BrowserPageState(
                        target_key=str(target_key),
                        target_name=str(target.name),
                        title=keyword,
                        url=f"https://example.com/{target_key}",
                        user_data_dir=Path(f"C:/fake/{target_key}"),
                    ),
                    title_matched=True,
                    fill_result=LoginFillResult(clicked_login_entry=bool(allow_click_login_entry), filled=False, detail=f"{target.name} 未配置账号密码，将等待人工输入。"),
                )

        service.browser = FakeLoginBrowser()  # type: ignore[assignment]

        service.open_login_target("service")
        self.assertEqual(service.indicators["service"]["state"], "ok")

        service.save_form(dict(service.get_form_state()))

        self.assertEqual(service.indicators["service"]["state"], "ok")
        self.assertIn("已检测到", "\n".join(service.log_lines))

    def test_manual_login_watch_keeps_waiting_when_user_has_not_finished_login(self) -> None:
        service = self._make_service(_ImmediateManualWatchService)

        class WaitingLoginBrowser:
            def update_login_flow(self, _login_flow) -> None:
                return

            def open_page(self, *, target_key, target, credentials, url):
                return BrowserPageState(
                    target_key=str(target_key),
                    target_name=str(target.name),
                    title="京东-欢迎登录",
                    url=str(url),
                    user_data_dir=Path(f"C:/fake/{target_key}"),
                )

            def probe_login_page(self, *, target_key, target, credentials, allow_click_login_entry):
                return BrowserLoginProbe(
                    page_state=BrowserPageState(
                        target_key=str(target_key),
                        target_name=str(target.name),
                        title="京东-欢迎登录",
                        url=f"https://example.com/{target_key}",
                        user_data_dir=Path(f"C:/fake/{target_key}"),
                    ),
                    title_matched=False,
                    fill_result=LoginFillResult(detail=f"{target.name} 页面验证码或弹层正在遮挡自动操作，请手动完成验证码/登录；后台会继续检测目标页面。"),
                )

        service.browser = WaitingLoginBrowser()  # type: ignore[assignment]

        with patch("clipboard_relay.web_control.service.time.sleep", side_effect=lambda _seconds: service.shutdown_event.set()):
            service.open_login_target("service")

        self.assertEqual(service.indicators["service"]["state"], "running")
        self.assertFalse(service.ready)
        self.assertNotIn("登录页检测失败", "\n".join(service.log_lines))

    def test_start_rechecks_open_pages_before_refusing_not_ready_state(self) -> None:
        class StartProbeService(_TestControlCenterService):
            def __init__(self, *, config_path: Path) -> None:
                super().__init__(config_path=config_path)
                self.started = False

            def _ensure_relay_thread(self, *, paused: bool) -> None:
                self.started = bool(paused)

        service = self._make_service(StartProbeService)

        class ReadyLoginBrowser:
            def probe_login_page(self, *, target_key, target, credentials, allow_click_login_entry):
                keyword = str(target.title_keywords[0]).lstrip("=")
                return BrowserLoginProbe(
                    page_state=BrowserPageState(
                        target_key=str(target_key),
                        target_name=str(target.name),
                        title=keyword,
                        url=f"https://example.com/{target_key}",
                        user_data_dir=Path(f"C:/fake/{target_key}"),
                    ),
                    title_matched=True,
                    fill_result=LoginFillResult(),
                )

        service.browser = ReadyLoginBrowser()  # type: ignore[assignment]
        service.ready = False

        service.start_or_resume()

        self.assertTrue(service.ready)
        self.assertTrue(service.started)
        self.assertEqual(service.indicators["browser"]["state"], "ok")
        self.assertIn("已发送启动/继续信号", service.log_lines[-1])

    def test_login_status_hides_long_redirect_url_from_homepage(self) -> None:
        service = self._make_service()
        long_title = "Loading https://sso.jd.hk/sso/sync/redirect?t=1&return=https://jdcs.jd.com/index.action"

        service._handle_login_message(f"已检测到：网页客户端｜{long_title}")

        self.assertEqual(service.indicators["web"]["detail"], "买家客户端已正常进入目标页面。")
        self.assertNotIn("https://", service.indicators["web"]["detail"])
        self.assertNotIn("https://", service.log_lines[-1])

    def test_login_wait_status_hides_long_redirect_url_from_homepage(self) -> None:
        service = self._make_service()
        long_title = "Loading https://sso.jd.hk/sso/sync/redirect?t=1&return=https://jdcs.jd.com/index.action"

        service._handle_login_message(f"等待登录：网页客户端，当前标题「{long_title}」。")

        self.assertEqual(service.indicators["web"]["detail"], "等待登录：网页客户端，当前标题「页面加载中」。")
        self.assertNotIn("https://", service.indicators["web"]["detail"])


if __name__ == "__main__":
    unittest.main()
