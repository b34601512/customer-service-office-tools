#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from douyin_commenter.app_metadata import APP_METADATA
from douyin_commenter.logger import init_logging, log


class RuntimeWindowlessTest(unittest.TestCase):
    def test_version_bumped_to_v06(self) -> None:
        # 该测试用于锁定本次发布版本号，避免打包文件名和页面显示回退。
        self.assertEqual(APP_METADATA.version, "v0.6")

    def test_logger_works_without_console_stdout(self) -> None:
        # 该测试用于确认 windowed/pythonw 模式没有控制台时日志仍然写入文件。
        original_stdout = sys.stdout
        with tempfile.TemporaryDirectory() as temp_dir:
            log_file = init_logging(Path(temp_dir))
            try:
                sys.stdout = None
                line = log("Test", "无窗口", "tests", "test_logger_works_without_console_stdout")
            finally:
                sys.stdout = original_stdout
            self.assertIn("无窗口", line)
            self.assertIn("无窗口", log_file.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
