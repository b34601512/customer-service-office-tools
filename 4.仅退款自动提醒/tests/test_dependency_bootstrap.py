#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest
from unittest.mock import patch

from refund_reminder.dependency_bootstrap import missing_required_modules, project_root


class DependencyBootstrapTest(unittest.TestCase):
    def test_project_root_contains_launcher(self) -> None:
        self.assertTrue((project_root() / "一键启动.vbs").exists())

    def test_missing_required_modules_reports_failed_import(self) -> None:
        with patch("refund_reminder.dependency_bootstrap.importlib.import_module") as mocked_import:
            mocked_import.side_effect = [object(), ModuleNotFoundError("No module named 'fake_missing'")]
            missing = missing_required_modules(("fake_ok", "fake_missing"))
        self.assertEqual(len(missing), 1)
        self.assertIn("fake_missing", missing[0])


if __name__ == "__main__":
    unittest.main()
