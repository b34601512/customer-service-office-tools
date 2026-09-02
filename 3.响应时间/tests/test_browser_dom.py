#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest
from unittest.mock import patch

from clipboard_relay.browser_dom import find_reply_input, overwrite_reply_input
from clipboard_relay.config import TargetConfig


class _FakeLocator:
    def __init__(self, index: int) -> None:
        self.index = index


class _FakeLocatorGroup:
    def nth(self, index: int) -> _FakeLocator:
        return _FakeLocator(index)


class _FakePage:
    def __init__(self, states: list[dict[str, object]]) -> None:
        self.states = list(states)
        self.evaluate_calls = 0
        self.locator_selector = ""

    def evaluate(self, script: str, selector: str) -> dict[str, object]:
        self.evaluate_calls += 1
        index = min(self.evaluate_calls - 1, len(self.states) - 1)
        return self.states[index]

    def locator(self, selector: str) -> _FakeLocatorGroup:
        self.locator_selector = selector
        return _FakeLocatorGroup()


class _FakeWritableLocator:
    def __init__(self) -> None:
        self.value = ""
        self.fill_value = ""
        self.dom_value = ""
        self.activate_count = 0
        self.scroll_count = 0
        self.click_count = 0
        self.click_errors: list[BaseException] = []
        self.scroll_error: BaseException | None = None
        self.fill_error: BaseException | None = None
        self.read_errors: list[BaseException] = []
        self.meta = {
            "tag": "textarea",
            "type": "",
            "role": "",
            "maxlength": -1,
            "placeholder": "请输入回复内容",
            "editable": True,
        }
        self.ready_state = {
            "connected": True,
            "visible": True,
            "editable": True,
            "disabled": False,
            "readonly": False,
            "in_viewport": True,
            "ready": True,
            "reason": "已就绪",
            "x": 0,
            "y": 0,
            "width": 300,
            "height": 40,
        }

    def click(self, **kwargs) -> None:
        self.click_count += 1
        if self.click_errors:
            raise self.click_errors.pop(0)

    def scroll_into_view_if_needed(self, **kwargs) -> None:
        self.scroll_count += 1
        if self.scroll_error is not None:
            raise self.scroll_error

    def fill(self, value: str, **kwargs) -> None:
        if self.fill_error is not None:
            raise self.fill_error
        self.fill_value = str(value)
        self.value = str(value)

    def evaluate(self, script: str, arg=None, **kwargs):
        if "maxlength" in script and "placeholder" in script:
            return dict(self.meta)
        if "scrollIntoView" in script and "focus" in script:
            self.activate_count += 1
            return True
        if "connected" in script and "in_viewport" in script:
            return dict(self.ready_state)
        if "dispatchEvent" in script:
            self.dom_value = str(arg or "")
            self.value = str(arg or "")
            return {"tag": "textarea", "type": "", "length": len(str(arg or ""))}
        if "'value' in node" in script:
            if self.read_errors:
                raise self.read_errors.pop(0)
            return self.value
        raise AssertionError(f"未预期的脚本：{script[:60]}")


class _FakeKeyboard:
    def __init__(self, locator: _FakeWritableLocator) -> None:
        self._locator = locator
        self.insert_text_value = ""
        self.press_calls: list[str] = []

    def press(self, key: str) -> None:
        self.press_calls.append(str(key))

    def insert_text(self, text: str) -> None:
        self.insert_text_value = str(text)
        self._locator.value = str(text)


class _FakeWritablePage:
    def __init__(self, locator: _FakeWritableLocator) -> None:
        self._locator = locator
        self.keyboard = _FakeKeyboard(locator)


class _FakeWritablePageWithDomRead(_FakeWritablePage):
    def evaluate(self, script: str, arg=None):
        if "未找到可读输入框" in script:
            return {
                "ok": True,
                "value": self._locator.value,
                "index": 0,
                "tag": "textarea",
                "type": "",
                "role": "",
                "count": 1,
                "visible_count": 1,
                "editable_count": 1,
            }
        if "未找到可写输入框" in script:
            value = str((arg or {}).get("value") or "")
            self._locator.value = value
            return {"ok": True, "value": value, "index": 0, "tag": "textarea", "type": "", "role": "", "length": len(value)}
        raise AssertionError(f"未预期的页面脚本：{script[:60]}")


def _target() -> TargetConfig:
    return TargetConfig("网页客户端", ("在线客服",), 0, (0.5, 0.8), True)


class BrowserDomTests(unittest.TestCase):
    def test_find_reply_input_waits_until_candidate_is_ready(self) -> None:
        page = _FakePage(
            [
                {"count": 1, "visible_count": 0, "editable_count": 0, "best": None},
                {
                    "count": 1,
                    "visible_count": 1,
                    "editable_count": 1,
                    "best": {"index": 0, "x": 309.9, "y": 804, "width": 760.1, "height": 56},
                },
            ]
        )

        with patch("clipboard_relay.browser_dom.time.sleep", return_value=None):
            locator = find_reply_input(page, _target())

        self.assertEqual(locator.index, 0)
        self.assertEqual(page.evaluate_calls, 2)
        self.assertIn("contenteditable", page.locator_selector)

    def test_overwrite_reply_input_waits_for_async_fill_readback(self) -> None:
        locator = _FakeWritableLocator()
        page = _FakeWritablePage(locator)
        reads = ["", "", "这是异步回读内容"]

        with patch("clipboard_relay.browser_dom.read_input_value", side_effect=lambda current: reads.pop(0)), patch(
            "clipboard_relay.browser_dom.time.sleep", return_value=None
        ):
            mode = overwrite_reply_input(page, locator, "这是异步回读内容")

        self.assertEqual(mode, "fill")
        self.assertEqual(locator.fill_value, "这是异步回读内容")

    def test_overwrite_reply_input_prefers_page_dom_when_page_supports_state_read(self) -> None:
        locator = _FakeWritableLocator()
        locator.read_errors.append(RuntimeError("Locator.evaluate: Timeout 10000ms exceeded"))
        page = _FakeWritablePageWithDomRead(locator)

        with patch("clipboard_relay.browser_dom.time.sleep", return_value=None):
            mode = overwrite_reply_input(page, locator, "页面重绘后仍继续发送")

        self.assertEqual(mode, "page_dom")
        self.assertEqual(locator.value, "页面重绘后仍继续发送")

    def test_overwrite_reply_input_skips_playwright_scroll_when_element_is_unstable(self) -> None:
        locator = _FakeWritableLocator()
        locator.scroll_error = RuntimeError("元素一直不稳定")
        page = _FakeWritablePage(locator)

        with patch("clipboard_relay.browser_dom.time.sleep", return_value=None):
            mode = overwrite_reply_input(page, locator, "元素不稳定也能写入")

        self.assertEqual(mode, "fill")
        self.assertEqual(locator.activate_count, 1)
        self.assertEqual(locator.scroll_count, 0)
        self.assertEqual(locator.click_count, 0)
        self.assertEqual(locator.fill_value, "元素不稳定也能写入")

    def test_overwrite_reply_input_uses_dom_fallback_when_keyboard_still_fails(self) -> None:
        locator = _FakeWritableLocator()
        page = _FakeWritablePage(locator)

        with patch(
            "clipboard_relay.browser_dom._wait_for_reply_input_value",
            side_effect=[(False, "", None), (False, "", None), (True, "DOM写入成功", None)],
        ), patch("clipboard_relay.browser_dom.time.sleep", return_value=None):
            mode = overwrite_reply_input(page, locator, "DOM写入成功")

        self.assertEqual(mode, "dom_fallback")
        self.assertEqual(locator.dom_value, "DOM写入成功")

    def test_overwrite_reply_input_marks_truncated_value_as_length_issue(self) -> None:
        locator = _FakeWritableLocator()
        locator.meta["maxlength"] = 500
        page = _FakeWritablePage(locator)
        expected = "A" * 1200
        locator.fill_error = RuntimeError("fill不支持该控件")
        locator.value = "A" * 500

        with patch("clipboard_relay.browser_dom.read_input_value", return_value="A" * 500), patch(
            "clipboard_relay.browser_dom.time.sleep", return_value=None
        ):
            with self.assertRaisesRegex(RuntimeError, "疑似页面截断：期望长度=1200，实际长度=500"):
                overwrite_reply_input(page, locator, expected)


if __name__ == "__main__":
    unittest.main()
