#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from clipboard_relay.app_metadata import APP_METADATA, build_window_title


class AppMetadataTests(unittest.TestCase):
    def test_metadata_matches_display_requirements(self) -> None:
        self.assertEqual(APP_METADATA.app_name, "响应时间")
        self.assertRegex(APP_METADATA.display_version, r"^v\d+\.\d+(\.\d+)?$")
        self.assertEqual(APP_METADATA.display_version, f"v{APP_METADATA.version}")

    def test_window_title_contains_version(self) -> None:
        self.assertEqual(build_window_title(), f"响应时间 {APP_METADATA.display_version} 后台")


if __name__ == "__main__":
    unittest.main()
