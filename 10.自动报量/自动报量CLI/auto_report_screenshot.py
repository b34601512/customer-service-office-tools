from __future__ import annotations

from pathlib import Path


def write_result_screenshot(screenshot_path: Path, screenshot_bytes: bytes) -> None:
    """保存结果截图文件。"""
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    screenshot_path.write_bytes(screenshot_bytes)
