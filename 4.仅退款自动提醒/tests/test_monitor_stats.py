#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from refund_reminder.monitor_stats import MonitorStatsStore


class MonitorStatsTest(unittest.TestCase):
    def test_mark_success_persists_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime" / "monitor_stats.json"
            store = MonitorStatsStore(path)
            self.assertEqual(store.snapshot().successful_scan_count, 0)

            first = store.mark_success()
            second = store.mark_success()

            self.assertEqual(first.successful_scan_count, 1)
            self.assertEqual(second.successful_scan_count, 2)
            self.assertGreater(second.last_success_at, 0)
            self.assertGreater(second.updated_at, 0)

            reloaded = MonitorStatsStore(path)
            self.assertEqual(reloaded.snapshot().successful_scan_count, 2)
            self.assertEqual(reloaded.snapshot().last_success_at, second.last_success_at)

    def test_invalid_count_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "monitor_stats.json"
            path.write_text('{"successful_scan_count": -1}', encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "不能小于 0"):
                MonitorStatsStore(path)


if __name__ == "__main__":
    unittest.main()
