#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from clipboard_relay.config import AppConfig, CredentialConfig, CredentialsConfig, HotkeyConfig, LoginFlowConfig, TargetConfig
from clipboard_relay.controller import RelayController
from clipboard_relay.hotkeys import HotkeyEvents
from clipboard_relay.temp_content import TempContentConfig


class FakeGenerator:
    def __init__(self, values: list[str]) -> None:
        self.values = list(values)
        self.generated: list[str] = []

    def generate_sentence(self) -> str:
        # 该函数用于按测试顺序返回预设文本，便于确认主流程不再依赖外部输入。
        if not self.values:
            raise RuntimeError("测试生成器没有剩余内容")
        text = str(self.values.pop(0))
        self.generated.append(text)
        return text


class FakeDesktop:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send_text_to_target(self, target: TargetConfig, text: str) -> None:
        self.sent.append((target.name, text))


class FakeHotkeys:
    def poll(self) -> HotkeyEvents:
        return HotkeyEvents()


def _config(*, rounds: int = 1) -> AppConfig:
    web = TargetConfig("网页客户端", ("京东",), 0, (0.5, 0.8), True)
    jd = TargetConfig("京东客服端", ("咚咚融合工作台",), 0, (0.5, 0.8), True)
    return AppConfig(
        jd_url="",
        jd_urls=(),
        service_url="https://dongdong.jd.com/",
        login_flow=LoginFlowConfig(True, True, 600, 1.0, False, ""),
        open_url_on_start=False,
        start_paused=False,
        rounds=rounds,
        temporary_content=TempContentConfig(3, 8, 5, 10, 2, 0.6, True, ("😍",)),
        web_client=web,
        jd_service=jd,
        credentials=CredentialsConfig(
            web_client=CredentialConfig("", ""),
            jd_service=CredentialConfig("", ""),
        ),
        hotkeys=HotkeyConfig("F8", "F9"),
    )


class ControllerTests(unittest.TestCase):
    def test_run_generates_direct_text_for_each_target(self) -> None:
        generator = FakeGenerator(["给网页1", "给客服1", "给网页2", "给客服2"])
        desktop = FakeDesktop()
        controller = RelayController(config=_config(rounds=2), desktop=desktop, hotkeys=FakeHotkeys(), content_generator=generator)
        controller.run()
        self.assertEqual(
            desktop.sent,
            [("网页客户端", "给网页1"), ("京东客服端", "给客服1"), ("网页客户端", "给网页2"), ("京东客服端", "给客服2")],
        )
        self.assertEqual(generator.generated, ["给网页1", "给客服1", "给网页2", "给客服2"])

    def test_content_generator_empty_text_raises_clear_error(self) -> None:
        generator = FakeGenerator(["   "])
        desktop = FakeDesktop()
        controller = RelayController(config=_config(), desktop=desktop, hotkeys=FakeHotkeys(), content_generator=generator)
        with self.assertRaisesRegex(RuntimeError, "内容生成失败：网页客户端 收到空文本"):
            controller.run()

    def test_status_callback_reports_progress(self) -> None:
        generator = FakeGenerator(["给网页", "给客服"])
        desktop = FakeDesktop()
        statuses: list[dict[str, object]] = []
        controller = RelayController(config=_config(), desktop=desktop, hotkeys=FakeHotkeys(), content_generator=generator, status_callback=statuses.append)
        controller.run()
        self.assertTrue(statuses)
        self.assertEqual(statuses[-1]["phase"], "已完成")
        self.assertEqual(statuses[-1]["completed_rounds"], 1)
        self.assertEqual(statuses[-1]["total_rounds"], 1)

    def test_rest_is_checked_only_after_service_side_send(self) -> None:
        class CountingController(RelayController):
            def __init__(self, **kwargs) -> None:
                super().__init__(**kwargs)
                self.rest_checks = 0

            def _rest_if_needed(self) -> None:
                self.rest_checks += 1

        generator = FakeGenerator(["给网页", "给客服"])
        desktop = FakeDesktop()
        controller = CountingController(config=_config(), desktop=desktop, hotkeys=FakeHotkeys(), content_generator=generator)
        controller.run()
        self.assertEqual(controller.rest_checks, 1)


if __name__ == "__main__":
    unittest.main()
