#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from clipboard_relay.runtime_paths import get_app_root, get_bundle_root, get_web_root, is_frozen


class RuntimePathsTests(unittest.TestCase):
    def test_source_mode_paths_point_to_project(self) -> None:
        self.assertFalse(is_frozen())
        self.assertTrue((get_app_root() / "config.json").exists())
        self.assertTrue((get_bundle_root() / "clipboard_relay").exists())
        self.assertTrue((get_web_root() / "index.html").exists())


if __name__ == "__main__":
    unittest.main()
