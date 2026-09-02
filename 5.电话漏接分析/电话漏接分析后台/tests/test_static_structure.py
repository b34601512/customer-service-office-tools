from __future__ import annotations

import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROJECT_PARENT = PROJECT_ROOT.parent


class CliStructureTest(unittest.TestCase):
    def test_cli_is_the_only_local_management_entry(self) -> None:
        cli_entry = PROJECT_ROOT / "cli.py"
        startup_script = PROJECT_PARENT / "一键启动.bat"

        self.assertTrue(cli_entry.is_file())
        startup_text = startup_script.read_text(encoding="utf-8")
        self.assertIn("cli.py", startup_text)
        self.assertNotIn("app.py", startup_text)

    def test_web_management_files_are_not_left_in_the_project(self) -> None:
        removed_web_paths = [
            PROJECT_ROOT / "index.html",
            PROJECT_ROOT / "static",
            PROJECT_ROOT / "app.py",
            PROJECT_ROOT / "missed_call_backend" / "server.py",
            PROJECT_ROOT / "missed_call_backend" / "web_app.py",
        ]
        for path in removed_web_paths:
            self.assertFalse(path.exists(), path.as_posix())

    def test_cli_source_files_stay_below_giant_threshold(self) -> None:
        checked_roots = [PROJECT_ROOT / "missed_call_backend", PROJECT_ROOT]
        oversized = []
        checked_paths: set[Path] = set()
        for root in checked_roots:
            for path in root.rglob("*.py"):
                if path in checked_paths or "__pycache__" in path.parts:
                    continue
                checked_paths.add(path)
                line_count = len(path.read_text(encoding="utf-8").splitlines())
                if line_count >= 800:
                    oversized.append((path.relative_to(PROJECT_ROOT).as_posix(), line_count))
        self.assertEqual(oversized, [])

    def test_cli_has_no_user_selectable_page_size(self) -> None:
        cli_app_text = (PROJECT_ROOT / "missed_call_backend" / "cli_app.py").read_text(encoding="utf-8")
        cli_input_text = (PROJECT_ROOT / "missed_call_backend" / "cli_input.py").read_text(encoding="utf-8")

        self.assertNotIn("prompt_page_size", cli_app_text)
        self.assertNotIn("prompt_page_size", cli_input_text)
        self.assertNotIn("PAGE_SIZE_OPTIONS", cli_input_text)
        self.assertIn("DEFAULT_LONG_LIST_PAGE_SIZE = 25", cli_input_text)


if __name__ == "__main__":
    unittest.main()
