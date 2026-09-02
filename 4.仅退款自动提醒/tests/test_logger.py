#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import io
import unittest
from contextlib import redirect_stdout

from refund_reminder.logger import log


class LoggerTest(unittest.TestCase):
    def test_log_allows_action_keyword_in_extra_fields(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            log("测试", "主动作", "unit", "sub", action="筛选动作", result="ok")
        text = output.getvalue()
        self.assertIn("主线:测试:主动作", text)
        self.assertIn("action='筛选动作'", text)
        self.assertIn("result='ok'", text)


if __name__ == "__main__":
    unittest.main()
