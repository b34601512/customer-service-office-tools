#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from douyin_commenter.config import DEFAULT_RANDOM_COUNTDOWN_SECONDS, default_config


class ConfigDefaultsTest(unittest.TestCase):
    def test_random_countdown_default_is_30_seconds(self) -> None:
        # 该测试用于锁定自动评论倒计时默认值，避免未来误改回 300 秒。
        self.assertEqual(DEFAULT_RANDOM_COUNTDOWN_SECONDS, 30)
        self.assertEqual(default_config().schedule.random_countdown_seconds, 30)


if __name__ == "__main__":
    unittest.main()
