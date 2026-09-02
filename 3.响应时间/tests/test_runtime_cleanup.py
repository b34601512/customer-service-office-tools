#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from clipboard_relay.runtime_cleanup import (
    RuntimeBloatPolicy,
    cleanup_live_runtime_bloat,
    cleanup_previous_runtime_artifacts,
    cleanup_shutdown_runtime_artifacts,
    iter_source_cache_directories,
)


class RuntimeCleanupTests(unittest.TestCase):
    def test_cleanup_moves_runtime_artifacts_but_keeps_user_config_and_browser_profiles(self) -> None:
        # 该测试用于确认启动清理只处理可重建产物，用户配置和登录态必须长期保留。
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "app"
            backup_root = Path(temp_dir) / "backup"
            (root / "logs").mkdir(parents=True)
            (root / ".pytest_cache").mkdir(parents=True)
            (root / "clipboard_relay" / "__pycache__").mkdir(parents=True)
            (root / "runtime" / "browser_profiles" / "chrome").mkdir(parents=True)
            (root / "logs" / "startup.log").write_text("old", encoding="utf-8")
            (root / ".pytest_cache" / "state").write_text("old", encoding="utf-8")
            (root / "clipboard_relay" / "__pycache__" / "module.pyc").write_text("old", encoding="utf-8")
            (root / "runtime" / "browser_profiles" / "chrome" / "state.txt").write_text("old", encoding="utf-8")
            (root / "config.json").write_text("{}", encoding="utf-8")

            moved = cleanup_previous_runtime_artifacts(root, backup_root=backup_root)

            self.assertEqual(len(moved), 3)
            self.assertTrue((root / "config.json").exists())
            self.assertTrue((root / "runtime" / "browser_profiles" / "chrome" / "state.txt").exists())
            self.assertFalse((root / "logs").exists())
            self.assertFalse((root / ".pytest_cache").exists())
            self.assertFalse((root / "clipboard_relay" / "__pycache__").exists())
            self.assertTrue((backup_root / "logs" / "startup.log").exists())
            self.assertTrue((backup_root / ".pytest_cache" / "state").exists())
            self.assertTrue((backup_root / "clipboard_relay" / "__pycache__" / "module.pyc").exists())
            self.assertFalse((backup_root / "runtime" / "browser_profiles" / "chrome" / "state.txt").exists())

    def test_cleanup_prepares_browser_profiles_without_moving_them(self) -> None:
        # 该测试用于确认启动清理只收尾本工具浏览器进程，不搬走保存登录态的资料。
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "app"
            backup_root = Path(temp_dir) / "backup"
            browser_profile_root = root / "runtime" / "browser_profiles"
            browser_profile_root.mkdir(parents=True)
            (browser_profile_root / "state.txt").write_text("old", encoding="utf-8")
            prepared_paths: list[Path] = []

            def prepare_browser_profiles(path: Path) -> None:
                prepared_paths.append(path)

            moved = cleanup_previous_runtime_artifacts(root, backup_root=backup_root, prepare_browser_profiles=prepare_browser_profiles)

            self.assertEqual(prepared_paths, [browser_profile_root])
            self.assertEqual(len(moved), 0)
            self.assertTrue((browser_profile_root / "state.txt").exists())
            self.assertFalse((backup_root / "runtime" / "browser_profiles" / "state.txt").exists())

    def test_live_cleanup_moves_oversized_artifacts_but_keeps_user_files(self) -> None:
        # 该测试用于确认运行中只处理超出安全线的膨胀产物，不碰配置和正在使用的浏览器资料。
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "app"
            backup_root = Path(temp_dir) / "backup"
            policy = RuntimeBloatPolicy(max_startup_log_bytes=5, max_cache_bytes=5, maintenance_interval_sec=1)
            (root / "logs").mkdir(parents=True)
            (root / ".pytest_cache").mkdir(parents=True)
            (root / "runtime" / "browser_profiles" / "chrome").mkdir(parents=True)
            (root / "runtime" / "python_env" / "__pycache__").mkdir(parents=True)
            (root / "logs" / "startup.log").write_text("123456", encoding="utf-8")
            (root / "logs" / "last_startup.log").write_text(str(root / "logs" / "startup.log"), encoding="utf-8")
            (root / ".pytest_cache" / "state").write_text("123456", encoding="utf-8")
            (root / "runtime" / "browser_profiles" / "chrome" / "state.txt").write_text("123456", encoding="utf-8")
            (root / "runtime" / "python_env" / "__pycache__" / "module.pyc").write_text("123456", encoding="utf-8")
            (root / "runtime" / "usage_history.json").write_text("{}", encoding="utf-8")
            (root / "config.json").write_text("{}", encoding="utf-8")

            moved = cleanup_live_runtime_bloat(root, policy=policy, backup_root=backup_root)

            self.assertEqual(len(moved), 2)
            self.assertTrue((root / "config.json").exists())
            self.assertTrue((root / "runtime" / "usage_history.json").exists())
            self.assertTrue((root / "runtime" / "browser_profiles" / "chrome" / "state.txt").exists())
            self.assertTrue((root / "runtime" / "python_env" / "__pycache__" / "module.pyc").exists())
            self.assertTrue((root / "logs" / "startup.log").exists())
            self.assertTrue((backup_root / "logs" / "startup.log").exists())
            self.assertTrue((backup_root / ".pytest_cache" / "state").exists())

    def test_live_cleanup_moves_source_cache_when_total_exceeds_limit(self) -> None:
        # 该测试用于确认源码缓存超线后会搬走，但依赖、发布包和运行目录不会被扫描处理。
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "app"
            backup_root = Path(temp_dir) / "backup"
            policy = RuntimeBloatPolicy(max_startup_log_bytes=100, max_cache_bytes=5, maintenance_interval_sec=1)
            (root / "clipboard_relay" / "__pycache__").mkdir(parents=True)
            (root / "runtime" / "python_env" / "__pycache__").mkdir(parents=True)
            (root / "dist" / "pkg" / "__pycache__").mkdir(parents=True)
            (root / ".git" / "objects" / "__pycache__").mkdir(parents=True)
            (root / "node_modules" / "pkg" / "__pycache__").mkdir(parents=True)
            (root / ".venv" / "Lib" / "__pycache__").mkdir(parents=True)
            (root / "发布包" / "__pycache__").mkdir(parents=True)
            (root / "clipboard_relay" / "__pycache__" / "module.pyc").write_text("123456", encoding="utf-8")
            (root / "runtime" / "python_env" / "__pycache__" / "module.pyc").write_text("123456", encoding="utf-8")
            (root / "dist" / "pkg" / "__pycache__" / "module.pyc").write_text("123456", encoding="utf-8")
            (root / ".git" / "objects" / "__pycache__" / "module.pyc").write_text("123456", encoding="utf-8")
            (root / "node_modules" / "pkg" / "__pycache__" / "module.pyc").write_text("123456", encoding="utf-8")
            (root / ".venv" / "Lib" / "__pycache__" / "module.pyc").write_text("123456", encoding="utf-8")
            (root / "发布包" / "__pycache__" / "module.pyc").write_text("123456", encoding="utf-8")

            scanned = iter_source_cache_directories(root)
            moved = cleanup_live_runtime_bloat(root, policy=policy, backup_root=backup_root)

            self.assertEqual(scanned, [root / "clipboard_relay" / "__pycache__"])
            self.assertEqual(len(moved), 1)
            self.assertFalse((root / "clipboard_relay" / "__pycache__").exists())
            self.assertTrue((root / "runtime" / "python_env" / "__pycache__").exists())
            self.assertTrue((root / "dist" / "pkg" / "__pycache__").exists())
            self.assertTrue((root / ".git" / "objects" / "__pycache__").exists())
            self.assertTrue((root / "node_modules" / "pkg" / "__pycache__").exists())
            self.assertTrue((root / ".venv" / "Lib" / "__pycache__").exists())
            self.assertTrue((root / "发布包" / "__pycache__").exists())
            self.assertTrue((backup_root / "clipboard_relay" / "__pycache__" / "module.pyc").exists())

    def test_shutdown_cleanup_keeps_browser_profiles_and_moves_cache(self) -> None:
        # 该测试用于确认退出清理保留浏览器登录态，只搬走可重建缓存。
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "app"
            backup_root = Path(temp_dir) / "backup"
            (root / "runtime" / "browser_profiles" / "chrome").mkdir(parents=True)
            (root / ".pytest_cache").mkdir(parents=True)
            (root / "runtime" / "browser_profiles" / "chrome" / "state.txt").write_text("old", encoding="utf-8")
            (root / ".pytest_cache" / "state").write_text("old", encoding="utf-8")
            (root / "runtime" / "usage_history.json").write_text("{}", encoding="utf-8")
            (root / "config.json").write_text("{}", encoding="utf-8")

            moved = cleanup_shutdown_runtime_artifacts(root, backup_root=backup_root)

            self.assertEqual(len(moved), 1)
            self.assertTrue((root / "config.json").exists())
            self.assertTrue((root / "runtime" / "usage_history.json").exists())
            self.assertTrue((root / "runtime" / "browser_profiles" / "chrome" / "state.txt").exists())
            self.assertFalse((root / ".pytest_cache").exists())
            self.assertTrue((backup_root / ".pytest_cache" / "state").exists())
            self.assertFalse((backup_root / "runtime" / "browser_profiles" / "chrome" / "state.txt").exists())


if __name__ == "__main__":
    unittest.main()
