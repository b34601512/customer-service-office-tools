#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from refund_reminder.runtime_maintenance import browser_runtime_arguments, clean_browser_profile_cache, run_runtime_startup_maintenance


class RuntimeMaintenanceTest(unittest.TestCase):
    def test_browser_cache_cleanup_keeps_login_state_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            profile = Path(tmp) / "runtime" / "browser_profiles" / "control_center"
            cache_file = profile / "Default" / "Cache" / "Cache_Data" / "data_3"
            code_cache_file = profile / "Default" / "Code Cache" / "js" / "cache.js"
            login_file = profile / "Default" / "Login Data"
            cookie_file = profile / "Default" / "Cookies"
            for file in (cache_file, code_cache_file, login_file, cookie_file):
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("x", encoding="utf-8")

            report = clean_browser_profile_cache(profile)

            self.assertEqual(report.removed_count, 2)
            self.assertFalse((profile / "Default" / "Cache").exists())
            self.assertFalse((profile / "Default" / "Code Cache").exists())
            self.assertTrue(login_file.exists())
            self.assertTrue(cookie_file.exists())

    def test_browser_runtime_arguments_disable_background_cache_growth(self) -> None:
        args = browser_runtime_arguments("--extra-test-arg")

        self.assertIn("--disable-component-update", args)
        self.assertIn("--safebrowsing-disable-auto-update", args)
        self.assertIn("--extra-test-arg", args)

    def test_startup_maintenance_cleans_existing_browser_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache_file = root / "runtime" / "browser_profiles" / "chrome" / "erp" / "Default" / "Cache" / "Cache_Data" / "data"
            login_file = root / "runtime" / "browser_profiles" / "chrome" / "erp" / "Default" / "Login Data"
            for file in (cache_file, login_file):
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("x", encoding="utf-8")

            with patch("refund_reminder.runtime_maintenance.startup_maintenance.stop_processes_matching_paths", return_value=["123"]) as stop_mock:
                report = run_runtime_startup_maintenance(root)

            stop_mock.assert_called_once()
            self.assertEqual(report.removed_count, 1)
            self.assertFalse((root / "runtime" / "browser_profiles" / "chrome" / "erp" / "Default" / "Cache").exists())
            self.assertTrue(login_file.exists())


if __name__ == "__main__":
    unittest.main()
