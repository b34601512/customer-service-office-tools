#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from ..temp_content import TempContentConfig, default_temp_content_config
from .validators import as_bool, as_float, as_int


def load_temp_content(raw: Any) -> TempContentConfig:
    # 该函数用于读取内容生成器配置，当前版本固定走内置内容直连发送。
    default = default_temp_content_config()
    if raw is None:
        return default
    if not isinstance(raw, dict):
        raise RuntimeError("配置错误：temporary_content 必须是对象")
    emojis_raw = raw.get("emojis", list(default.emojis))
    if not isinstance(emojis_raw, list):
        raise RuntimeError("配置错误：temporary_content.emojis 必须是字符串列表")
    emojis = tuple(str(item or "").strip() for item in emojis_raw if str(item or "").strip())
    emoji_probability = as_float(
        raw.get("emoji_append_probability", default.emoji_append_probability),
        field="temporary_content.emoji_append_probability",
        min_value=0.0,
    )
    if emoji_probability > 1.0:
        raise RuntimeError("配置错误：temporary_content.emoji_append_probability 不能大于 1")
    emoji_min_count = as_int(raw.get("emoji_min_count", default.emoji_min_count), field="temporary_content.emoji_min_count", min_value=1)
    emoji_max_count = as_int(raw.get("emoji_max_count", default.emoji_max_count), field="temporary_content.emoji_max_count", min_value=1)
    if emoji_max_count < emoji_min_count:
        raise RuntimeError("配置错误：temporary_content.emoji_max_count 不能小于 emoji_min_count")
    return TempContentConfig(
        min_word_length=as_int(raw.get("min_word_length", default.min_word_length), field="temporary_content.min_word_length", min_value=1),
        max_word_length=as_int(raw.get("max_word_length", default.max_word_length), field="temporary_content.max_word_length", min_value=1),
        min_words=as_int(raw.get("min_words", default.min_words), field="temporary_content.min_words", min_value=1),
        max_words=as_int(raw.get("max_words", default.max_words), field="temporary_content.max_words", min_value=1),
        uppercase_max_count=as_int(raw.get("uppercase_max_count", default.uppercase_max_count), field="temporary_content.uppercase_max_count", min_value=0),
        uppercase_probability=as_float(raw.get("uppercase_probability", default.uppercase_probability), field="temporary_content.uppercase_probability", min_value=0.0),
        append_emoji_when_uppercase=as_bool(
            raw.get("append_emoji_when_uppercase", default.append_emoji_when_uppercase),
            field="temporary_content.append_emoji_when_uppercase",
        ),
        emojis=emojis,
        emoji_append_probability=emoji_probability,
        emoji_min_count=emoji_min_count,
        emoji_max_count=emoji_max_count,
    )

