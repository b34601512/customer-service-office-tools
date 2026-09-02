#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from clipboard_relay.temp_content import SYSTEM_EMOJIS, TempContentConfig, TempContentGenerator, default_temp_content_config


class TempContentTests(unittest.TestCase):
    def test_random_emoji_can_append_multiple_system_emojis(self) -> None:
        config = TempContentConfig(
            min_word_length=3,
            max_word_length=3,
            min_words=1,
            max_words=1,
            uppercase_max_count=0,
            uppercase_probability=0,
            append_emoji_when_uppercase=False,
            emojis=("😍",),
            emoji_append_probability=1,
            emoji_min_count=2,
            emoji_max_count=2,
        )
        text = TempContentGenerator(config).generate_sentence()
        self.assertEqual(text.count("😍"), 2)
        self.assertNotIn("/:", text)

    def test_default_emojis_are_system_emojis(self) -> None:
        config = default_temp_content_config()
        self.assertEqual(config.emojis, SYSTEM_EMOJIS)
        self.assertTrue(config.emojis)
        self.assertFalse(any(item.startswith("/:") for item in config.emojis))


if __name__ == "__main__":
    unittest.main()
