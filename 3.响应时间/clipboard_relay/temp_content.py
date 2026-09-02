#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import random
from dataclasses import dataclass

from .logger import log

_MODULE = "clipboard_relay.temp_content"

SYSTEM_EMOJIS = (
    "😍",
    "🤔",
    "😶",
    "✌️",
    "👈",
    "🙄",
    "😎",
    "😊",
    "🌹",
    "👍",
    "😲",
    "❤️",
    "🥺",
    "🎁",
)


@dataclass(frozen=True)
class TempContentConfig:
    min_word_length: int
    max_word_length: int
    min_words: int
    max_words: int
    uppercase_max_count: int
    uppercase_probability: float
    append_emoji_when_uppercase: bool
    emojis: tuple[str, ...]
    emoji_append_probability: float = 0.45
    emoji_min_count: int = 1
    emoji_max_count: int = 3


class TempContentGenerator:
    def __init__(self, config: TempContentConfig) -> None:
        # 该对象用于生成直连发送内容，避免再依赖系统剪切板或外部造句工具。
        self._config = config
        self._vowels = "aeiou"
        self._consonants = "bcdfghjklmnpqrstvwxyz"

    def _generate_word(self) -> str:
        # 该函数用于生成一个伪英文单词，保持和旧脚本相近的随机结构。
        min_len = max(1, int(self._config.min_word_length))
        max_len = max(min_len, int(self._config.max_word_length))
        length = random.randint(min_len, max_len)
        chars: list[str] = []
        for index in range(length):
            if index % 2 == 0:
                chars.append(random.choice(self._vowels))
            else:
                chars.append(random.choice(self._consonants))
        return "".join(chars)

    def generate_sentence(self) -> str:
        # 该函数用于生成一条可直接写入页面输入框的回复内容。
        min_words = max(1, int(self._config.min_words))
        max_words = max(min_words, int(self._config.max_words))
        words = [self._generate_word() for _ in range(random.randint(min_words, max_words))]
        uppercase_made = False
        max_uppercase = max(0, int(self._config.uppercase_max_count))
        for _ in range(random.randint(0, max_uppercase)):
            index = random.randint(0, len(words) - 1)
            if random.random() < float(self._config.uppercase_probability):
                word = words[index]
                words[index] = word[:1].upper() + word[1:]
                uppercase_made = True
        sentence = " ".join(words) + random.choice([".", "!", "?"])
        should_append_emoji = bool(self._config.emojis) and random.random() < max(0.0, min(1.0, float(self._config.emoji_append_probability)))
        if should_append_emoji:
            min_count = max(1, int(self._config.emoji_min_count))
            max_count = max(min_count, int(self._config.emoji_max_count))
            emojis = " ".join(random.choice(self._config.emojis) for _ in range(random.randint(min_count, max_count)))
            sentence = f"{sentence} {emojis}"
        elif uppercase_made and bool(self._config.append_emoji_when_uppercase) and self._config.emojis:
            sentence = f"{sentence} {random.choice(self._config.emojis)}"
        log("Generator", "生成发送内容", _MODULE, "generate_sentence", length=len(sentence), text=sentence)
        return sentence


def default_temp_content_config() -> TempContentConfig:
    # 该函数用于给内容引擎提供缺省参数，确保默认配置就能直接发送。
    return TempContentConfig(
        min_word_length=3,
        max_word_length=8,
        min_words=5,
        max_words=10,
        uppercase_max_count=2,
        uppercase_probability=0.6,
        append_emoji_when_uppercase=True,
        emojis=SYSTEM_EMOJIS,
        emoji_append_probability=0.45,
        emoji_min_count=1,
        emoji_max_count=3,
    )


__all__ = ["SYSTEM_EMOJIS", "TempContentConfig", "TempContentGenerator", "default_temp_content_config"]
