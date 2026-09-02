#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from clipboard_relay.browser_control import _display_title_text, _title_matches


class BrowserTitleMatcherTests(unittest.TestCase):
    def test_loading_redirect_url_does_not_match_business_keyword(self) -> None:
        # 该测试用于防止跳转页标题里的 URL 关键词被误判成已进入业务页面。
        title = "Loading https://sso.jd.hk/sso/sync/redirect?t=1&return=https://jdcs.jd.com/index.action"

        self.assertFalse(_title_matches(title, ("jdcs", "在线客服")))
        self.assertEqual(_display_title_text(title), "页面加载中")

    def test_normal_business_title_still_matches(self) -> None:
        # 该测试用于确认排除跳转页后，正常业务标题仍然能判定成功。
        self.assertTrue(_title_matches("在线客服", ("jdcs", "在线客服")))
        self.assertEqual(_display_title_text("在线客服"), "在线客服")


if __name__ == "__main__":
    unittest.main()
