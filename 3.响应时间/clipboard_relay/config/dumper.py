#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .buyer_urls import chunk_text, config_url_entries
from .credentials import credential_entries_with_current
from .models import AppConfig
from .validators import json_number


def app_config_to_dict(config: AppConfig) -> dict[str, Any]:
    # 该函数用于把强类型配置写回 JSON，供后台保存配置使用。
    jd_url_entries = config_url_entries(config.jd_urls, config.jd_url_entries)
    web_client_entries = credential_entries_with_current(config.credentials.web_client_entries, config.credentials.web_client)
    jd_service_entries = credential_entries_with_current(config.credentials.jd_service_entries, config.credentials.jd_service)
    return {
        "_comment": "该配置由后台保存；买家咨询链接可保存多个，note 是店铺备注，长链接用 *_parts 分段拼接，避免单行过长。",
        "jd_url": "",
        "jd_url_parts": chunk_text(config.jd_url),
        "jd_urls": [{"url": "", "url_parts": chunk_text(entry.url), "note": entry.note} for entry in jd_url_entries],
        "service_url": config.service_url,
        "login_flow": {
            "enabled": config.login_flow.enabled,
            "open_urls_in_new_window": config.login_flow.open_urls_in_new_window,
            "login_wait_timeout_sec": json_number(config.login_flow.login_wait_timeout_sec),
            "login_poll_interval_sec": json_number(config.login_flow.login_poll_interval_sec),
            "auto_start_on_panel_open": config.login_flow.auto_start_on_panel_open,
            "browser_executable": config.login_flow.browser_executable,
        },
        "credentials": {
            "web_client": {
                "username": config.credentials.web_client.username,
                "password": config.credentials.web_client.password,
            },
            "web_client_entries": [
                {"username": entry.username, "password": entry.password, "note": entry.note}
                for entry in web_client_entries
            ],
            "jd_service": {
                "username": config.credentials.jd_service.username,
                "password": config.credentials.jd_service.password,
            },
            "jd_service_entries": [
                {"username": entry.username, "password": entry.password, "note": entry.note}
                for entry in jd_service_entries
            ],
        },
        "open_url_on_start": config.open_url_on_start,
        "start_paused": config.start_paused,
        "rounds": config.rounds,
        "work_duration_sec": json_number(config.work_duration_sec),
        "rest_duration_sec": json_number(config.rest_duration_sec),
        "temporary_content": {
            "min_word_length": config.temporary_content.min_word_length,
            "max_word_length": config.temporary_content.max_word_length,
            "min_words": config.temporary_content.min_words,
            "max_words": config.temporary_content.max_words,
            "uppercase_max_count": config.temporary_content.uppercase_max_count,
            "uppercase_probability": json_number(config.temporary_content.uppercase_probability),
            "append_emoji_when_uppercase": config.temporary_content.append_emoji_when_uppercase,
            "emojis": list(config.temporary_content.emojis),
            "emoji_append_probability": json_number(config.temporary_content.emoji_append_probability),
            "emoji_min_count": config.temporary_content.emoji_min_count,
            "emoji_max_count": config.temporary_content.emoji_max_count,
        },
        "web_client": {
            "name": config.web_client.name,
            "title_keywords": list(config.web_client.title_keywords),
            "send_delay_sec": json_number(config.web_client.send_delay_sec),
            "send_delay_random_min_sec": json_number(config.web_client.send_delay_random_min_sec),
            "send_delay_random_max_sec": json_number(config.web_client.send_delay_random_max_sec),
            "input_click_ratio": [json_number(value) for value in config.web_client.input_click_ratio],
            "press_enter": config.web_client.press_enter,
        },
        "jd_service": {
            "name": config.jd_service.name,
            "title_keywords": list(config.jd_service.title_keywords),
            "send_delay_sec": json_number(config.jd_service.send_delay_sec),
            "send_delay_random_min_sec": json_number(config.jd_service.send_delay_random_min_sec),
            "send_delay_random_max_sec": json_number(config.jd_service.send_delay_random_max_sec),
            "input_click_ratio": [json_number(value) for value in config.jd_service.input_click_ratio],
            "press_enter": config.jd_service.press_enter,
        },
        "hotkeys": {
            "pause_resume": config.hotkeys.pause_resume,
            "stop": config.hotkeys.stop,
        },
    }


def save_config(path: str | Path, config: AppConfig) -> None:
    # 该函数用于后台保存配置，统一 UTF-8 编码和 JSON 格式。
    config_path = Path(path)
    config_path.write_text(json.dumps(app_config_to_dict(config), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

