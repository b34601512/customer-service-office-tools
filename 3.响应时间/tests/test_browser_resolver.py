#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from clipboard_relay.browser_resolver import candidate_browsers, resolve_browser_executable
from clipboard_relay.config import LoginFlowConfig


class BrowserResolverTests(unittest.TestCase):
    def test_configured_browser_path_has_priority(self) -> None:
        configured = "C:\\Tools\\Chrome\\chrome.exe"
        self.assertEqual(candidate_browsers(configured)[0], configured)

    def test_resolve_browser_executable_returns_existing_candidate(self) -> None:
        config = LoginFlowConfig(True, True, 600, 1, True, "")
        with (
            patch("clipboard_relay.browser_resolver.candidate_browsers", return_value=["C:\\fake\\chrome.exe"]),
            patch.object(Path, "exists", return_value=True),
            patch("clipboard_relay.browser_resolver.shutil.which", return_value=None),
        ):
            self.assertEqual(resolve_browser_executable(config), "C:\\fake\\chrome.exe")


if __name__ == "__main__":
    unittest.main()
