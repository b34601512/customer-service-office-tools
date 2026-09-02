#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import traceback
from datetime import datetime
from pathlib import Path

from refund_reminder.config import load_config
from refund_reminder.runtime_paths import get_app_root, get_web_root
from refund_reminder.web_control.control_center_window_lifecycle import run_control_center_cleanup_watchdog_from_args


class StartupLogger:
    def __init__(self, root: Path) -> None:
        # 该对象用于把启动日志写入固定文件，每次启动先清空，避免 startup_*.log 持续堆积。
        self.root = Path(root)
        self.logs_dir = self.root / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.run_log = self.logs_dir / "startup.log"
        self.marker = self.logs_dir / "last_startup.log"
        self.run_log.write_text("", encoding="utf-8")
        self.marker.write_text(str(self.run_log), encoding="utf-8")
        self._write_raw(f"[{self._now()}] ========== START ==========")

    @staticmethod
    def _now() -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _write_raw(self, line: str) -> None:
        with self.run_log.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    def write(self, message: str) -> None:
        text = f"[{self._now()}] {message}"
        print(text, flush=True)
        self._write_raw(text)

    def write_block(self, text: str) -> None:
        for line in str(text or "").splitlines():
            self._write_raw(line)


def _is_check_mode(argv: list[str]) -> bool:
    # 该函数用于识别启动自检模式。
    normalized = {str(item or "").strip().lower() for item in argv}
    return "--check" in normalized or "check" in normalized


def _run_check(root: Path, logger: StartupLogger) -> int:
    # 该函数用于验证配置、Playwright 包和网页静态资源是否齐全。
    config_path = root / "config.json"
    load_config(config_path)
    from playwright.sync_api import sync_playwright  # noqa: F401

    web_root = get_web_root()
    for name in ("index.html", "button_feedback.js", "config_form.js", "order_card.js", "order_board.js", "app.js", "style.css", "base.css", "layout_form.css", "orders.css", "responsive.css"):
        path = web_root / name
        if not path.exists():
            raise RuntimeError(f"未找到网页资源：{path}")
    logger.write("CHECK_OK")
    logger.write("PLAYWRIGHT_OK")
    logger.write(f"WEB_ROOT_OK={web_root}")
    return 0


def main(argv: list[str] | None = None) -> int:
    # 该函数用于提供源码与打包后的统一入口。
    args = list(sys.argv[1:] if argv is None else argv)
    watchdog_exit_code = run_control_center_cleanup_watchdog_from_args(args)
    if watchdog_exit_code is not None:
        return int(watchdog_exit_code)
    root = get_app_root()
    logger = StartupLogger(root)
    try:
        logger.write(f"Workdir: {root}")
        logger.write(f"Executable: {Path(sys.executable).resolve()}")
        if _is_check_mode(args):
            return _run_check(root, logger)
        from refund_reminder.web_control.server import main as web_main

        return int(web_main())
    except Exception as exc:
        logger.write(f"ERROR: {exc}")
        logger.write_block(traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
