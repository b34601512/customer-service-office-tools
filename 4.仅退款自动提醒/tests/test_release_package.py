#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from release.file_ops import move_existing_path
from release.package_safety_guard import ensure_distribution_is_clean
from release.release_info import normalize_display_version, read_release_info


class ReleasePackageTest(unittest.TestCase):
    def test_release_info_uses_pack_config_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "打包配置.json").write_text('{"displayVersion": "0.01"}', encoding="utf-8")
            info = read_release_info(root)
            self.assertEqual(info.display_version, "v0.01")
            self.assertEqual(info.package_dir_name, "refund-reminder-cs-v0.01")

    def test_invalid_display_version_is_rejected(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "非法字符"):
            normalize_display_version("v0.01/bad")

    def test_move_existing_path_moves_to_backup_instead_of_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "dist" / "old.zip"
            source.parent.mkdir(parents=True)
            source.write_text("old", encoding="utf-8")
            backup = move_existing_path(source, root, "20260428-120000")
            self.assertFalse(source.exists())
            self.assertIsNotNone(backup)
            self.assertEqual(backup.read_text(encoding="utf-8"), "old")

    def test_safety_guard_rejects_runtime_login_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            package_dir = Path(tmp)
            (package_dir / "打包配置.json").write_text('{"displayVersion": "v0.01"}', encoding="utf-8")
            leaked = package_dir / "runtime" / "browser_profiles" / "cookie.txt"
            leaked.parent.mkdir(parents=True)
            leaked.write_text("secret", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "运行目录仍包含"):
                ensure_distribution_is_clean(package_dir, "v0.01")


if __name__ == "__main__":
    unittest.main()
