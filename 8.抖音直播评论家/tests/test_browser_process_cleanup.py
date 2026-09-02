#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from douyin_commenter.browser_control import BrowserControl


class BrowserProcessCleanupTest(unittest.TestCase):
    def test_profile_cleanup_uses_plain_short_command(self) -> None:
        with patch("douyin_commenter.browser_control.subprocess.run") as run:
            run.return_value.stdout = "123\n"
            process_ids = BrowserControl._kill_processes_matching_path(Path("D:/demo/profile"))  # noqa: SLF001

        command = run.call_args.args[0]
        self.assertEqual(process_ids, ["123"])
        self.assertIn("-Command", command)
        self.assertNotIn("-EncodedCommand", command)


if __name__ == "__main__":
    unittest.main()
