#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from refund_reminder.config import app_config_to_dict, default_config, load_config, save_config


class ConfigTest(unittest.TestCase):
    def test_default_config_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            config = default_config()
            save_config(path, config)
            loaded = load_config(path)
            self.assertEqual(app_config_to_dict(loaded), app_config_to_dict(config))
            self.assertEqual(loaded.login.browser_start_timeout_sec, 120)
            self.assertEqual(loaded.login.page_load_timeout_sec, 90)
            self.assertEqual(loaded.notification.max_notification_orders, 8)
            self.assertEqual(loaded.notification.payment_time_range_days, 1)

    def test_interval_cannot_less_than_five_minutes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                '{"login": {}, "monitor": {"interval_minutes": 4}, "detection": {}, "notification": {}}',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "不能小于 5"):
                load_config(path)

    def test_detection_config_no_longer_uses_payment_date_filter(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text('{"login": {}, "monitor": {}, "detection": {}, "notification": {}}', encoding="utf-8")
            self.assertFalse(hasattr(load_config(path).detection, "refund_application_date"))
            path.write_text('{"login": {}, "monitor": {}, "detection": {"refund_application_date": "2026/04/28"}, "notification": {}}', encoding="utf-8")
            self.assertFalse(hasattr(load_config(path).detection, "refund_application_date"))

    def test_legacy_payment_date_is_ignored_and_not_saved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text('{"login": {}, "monitor": {}, "detection": {"payment_date": "2026-04-28"}, "notification": {}}', encoding="utf-8")
            loaded = load_config(path)
            self.assertFalse(hasattr(loaded.detection, "refund_application_date"))
            self.assertNotIn("payment_date", app_config_to_dict(loaded)["detection"])

    def test_saved_config_does_not_write_obsolete_refund_void_columns(self) -> None:
        data = app_config_to_dict(default_config())

        self.assertNotIn("refund_column_names", data["detection"])
        self.assertNotIn("void_column_names", data["detection"])
        self.assertNotIn("operation_log_note_column_names", data["detection"])
        self.assertNotIn("operation_log_tab_names", data["detection"])
        self.assertNotIn("operation_log_date_column_names", data["detection"])
        self.assertNotIn("refund_status_log_keywords", data["detection"])
        self.assertNotIn("refund_application_date", data["detection"])
        self.assertNotIn("payment_date", data["detection"])

    def test_notification_order_limit_supports_legacy_popup_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text('{"login": {}, "monitor": {}, "detection": {}, "notification": {}}', encoding="utf-8")
            self.assertEqual(load_config(path).notification.max_notification_orders, 8)
            path.write_text('{"login": {}, "monitor": {}, "detection": {}, "notification": {"max_popup_orders": 2}}', encoding="utf-8")
            self.assertEqual(load_config(path).notification.max_notification_orders, 2)
            path.write_text('{"login": {}, "monitor": {}, "detection": {}, "notification": {"max_notification_orders": 0}}', encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "不能小于 1"):
                load_config(path)

    def test_notification_payment_time_range_defaults_to_today(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text('{"login": {}, "monitor": {}, "detection": {}, "notification": {}}', encoding="utf-8")
            self.assertEqual(load_config(path).notification.payment_time_range_days, 1)
            path.write_text('{"login": {}, "monitor": {}, "detection": {}, "notification": {"payment_time_range_days": 7}}', encoding="utf-8")
            self.assertEqual(load_config(path).notification.payment_time_range_days, 7)
            path.write_text('{"login": {}, "monitor": {}, "detection": {}, "notification": {"payment_time_range_days": 0}}', encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "不能小于 1"):
                load_config(path)


if __name__ == "__main__":
    unittest.main()
