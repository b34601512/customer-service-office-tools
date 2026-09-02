#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from clipboard_relay.config import app_config_to_dict, load_config


class ConfigTests(unittest.TestCase):
    def test_load_config_parses_jd_keyword(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "jd_url": "https://example.test",
                        "jd_url_parts": ["https://example.", "test/from_parts"],
                        "jd_urls": [
                            {"url_parts": ["https://shop-a.", "test"], "note": "A店"},
                            {"url": "", "note": "待补网址店"},
                            "https://shop-b.test",
                        ],
                        "rounds": 2,
                        "temporary_content": {},
                        "web_client": {
                            "name": "网页客户端",
                            "title_keywords": ["京东"],
                            "send_delay_sec": 0,
                            "input_click_ratio": [0.5, 0.8],
                            "press_enter": True,
                        },
                        "jd_service": {
                            "name": "京东客服端",
                            "title_keywords": ["咚咚融合工作台"],
                            "send_delay_sec": 0,
                            "input_click_ratio": [0.5, 0.8],
                            "press_enter": True,
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            config = load_config(path)
            self.assertEqual(config.jd_service.title_keywords, ("咚咚融合工作台",))
            self.assertEqual(config.rounds, 2)
            self.assertEqual(config.jd_url, "https://example.test/from_parts")
            self.assertEqual(config.jd_urls, ("https://example.test/from_parts", "https://shop-a.test", "https://shop-b.test"))
            self.assertEqual([entry.note for entry in config.jd_url_entries], ["", "A店", "待补网址店", ""])
            self.assertEqual(config.credentials.web_client.username, "")
            self.assertEqual(config.credentials.jd_service.password, "")
            self.assertEqual(config.work_duration_sec, 60)
            self.assertEqual(config.rest_duration_sec, 60)
            self.assertEqual(config.web_client.send_delay_random_min_sec, 3)
            self.assertEqual(config.web_client.send_delay_random_max_sec, 5)
            config_dict = app_config_to_dict(config)
            self.assertEqual(config_dict["credentials"]["web_client"]["username"], "")
            self.assertEqual(config_dict["credentials"]["jd_service"]["password"], "")
            self.assertEqual(config_dict["work_duration_sec"], 60)
            self.assertEqual(config_dict["rest_duration_sec"], 60)
            self.assertEqual(config_dict["web_client"]["send_delay_random_min_sec"], 3)
            self.assertEqual(config_dict["web_client"]["send_delay_random_max_sec"], 5)
            self.assertEqual(config_dict["temporary_content"]["emoji_append_probability"], 0.45)
            self.assertEqual(config_dict["jd_urls"][0]["url_parts"], ["https://example.test/from_parts"])
            self.assertEqual(config_dict["jd_urls"][1]["note"], "A店")
            self.assertEqual(config_dict["jd_urls"][2]["note"], "待补网址店")
            self.assertEqual(config_dict["jd_urls"][2]["url_parts"], [""])

    def test_load_config_migrates_multiple_credential_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "jd_url": "https://example.test",
                        "credentials": {
                            "jd_service": {"username": "service-current", "password": "service-pass"},
                            "jd_service_entries": [
                                {"username": "service-other", "password": "other-pass", "note": "京东6店"},
                                {"username": "", "password": "", "note": "待补账号店"},
                            ],
                            "web_client": {"username": "web-current", "password": "web-pass"},
                            "web_client_entries": [
                                {"username": "web-current", "password": "web-pass", "note": "京东3店"},
                            ],
                        },
                        "rounds": 2,
                        "temporary_content": {},
                        "web_client": {
                            "name": "网页客户端",
                            "title_keywords": ["京东"],
                            "send_delay_sec": 0,
                            "input_click_ratio": [0.5, 0.8],
                            "press_enter": True,
                        },
                        "jd_service": {
                            "name": "京东客服端",
                            "title_keywords": ["咚咚融合工作台"],
                            "send_delay_sec": 0,
                            "input_click_ratio": [0.5, 0.8],
                            "press_enter": True,
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            config = load_config(path)
            self.assertEqual(config.credentials.jd_service.username, "service-current")
            self.assertEqual(config.credentials.jd_service_entries[0].username, "service-current")
            self.assertEqual(config.credentials.jd_service_entries[1].note, "京东6店")
            self.assertEqual(config.credentials.jd_service_entries[2].note, "待补账号店")
            self.assertEqual(config.credentials.web_client_entries[0].note, "京东3店")

            config_dict = app_config_to_dict(config)
            self.assertEqual(config_dict["credentials"]["jd_service_entries"][0]["username"], "service-current")
            self.assertEqual(config_dict["credentials"]["jd_service_entries"][2]["note"], "待补账号店")


if __name__ == "__main__":
    unittest.main()
