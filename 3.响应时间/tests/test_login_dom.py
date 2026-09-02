#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from clipboard_relay.config import CredentialConfig
from clipboard_relay.login_dom import try_fill_login_form


class _FakeLocator:
    def __init__(self, *, visible: bool = False, class_name: str = "", click_error: BaseException | None = None) -> None:
        self.first = self
        self.visible = visible
        self.class_name = class_name
        self.click_error = click_error
        self.click_count = 0
        self.fill_value = ""

    def count(self) -> int:
        return 1 if self.visible else 0

    def is_visible(self, **_kwargs) -> bool:
        return self.visible

    def get_attribute(self, name: str, **_kwargs) -> str:
        return self.class_name if name == "class" else ""

    def click(self, **_kwargs) -> None:
        self.click_count += 1
        if self.click_error is not None:
            raise self.click_error

    def fill(self, value: str, **_kwargs) -> None:
        self.fill_value = str(value)


class _FakePage:
    def __init__(self, locators: dict[str, _FakeLocator]) -> None:
        self.locators = dict(locators)
        self.frames = []
        self.main_frame = self

    def locator(self, selector: str) -> _FakeLocator:
        return self.locators.get(selector, _FakeLocator())

    def wait_for_function(self, *_args, **_kwargs) -> None:
        return

    def wait_for_timeout(self, *_args, **_kwargs) -> None:
        return


class LoginDomTests(unittest.TestCase):
    def test_try_fill_login_form_keeps_waiting_when_captcha_blocks_account_switch(self) -> None:
        page = _FakePage(
            {
                "text=密码登录": _FakeLocator(
                    visible=True,
                    click_error=RuntimeError("captcha_dom intercepts pointer events"),
                )
            }
        )

        result = try_fill_login_form(
            page,
            CredentialConfig(username="demo", password="pwd"),
            target_name="京东客服端",
            allow_click_login_entry=True,
        )

        self.assertFalse(result.filled)
        self.assertIn("验证码或弹层", result.detail)
        self.assertIn("后台会继续检测目标页面", result.detail)


if __name__ == "__main__":
    unittest.main()
