#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from clipboard_relay.usage_history import record_software_open


class UsageHistoryTests(unittest.TestCase):
    def test_record_software_open_returns_previous_date_before_updating_today(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            first = record_software_open(root, today=date(2026, 5, 13))
            second = record_software_open(root, today=date(2026, 5, 14))

            history = json.loads((root / "runtime" / "usage_history.json").read_text(encoding="utf-8"))
            self.assertEqual(first["previousUsedDate"], "")
            self.assertEqual(first["previousUsedDateText"], "暂无记录")
            self.assertEqual(second["previousUsedDate"], "2026-05-13")
            self.assertEqual(second["previousUsedDateText"], "2026年05月13日")
            self.assertEqual(history["last_used_date"], "2026-05-14")

    def test_record_software_open_treats_corrupt_history_as_first_launch(self) -> None:
        # #607：断电半写留下的截断 JSON / 非 dict 根节点不应卡死启动主线。
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "usage_history.json").write_text('{"last_used_date": "2026-05-1', encoding="utf-8")
            first = record_software_open(root, today=date(2026, 5, 14))
            self.assertEqual(first["previousUsedDate"], "")
            self.assertEqual(first["previousUsedDateText"], "暂无记录")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "usage_history.json").write_text('["not", "a", "dict"]', encoding="utf-8")
            second = record_software_open(root, today=date(2026, 5, 15))
            self.assertEqual(second["previousUsedDate"], "")

    def test_record_software_open_rejects_broken_history_date(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "usage_history.json").write_text('{"last_used_date": "坏日期"}', encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "使用记录日期格式错误"):
                record_software_open(root, today=date(2026, 5, 14))


if __name__ == "__main__":
    unittest.main()
