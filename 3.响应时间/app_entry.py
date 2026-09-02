#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import traceback
from datetime import datetime
from pathlib import Path

from clipboard_relay.config import load_config
from clipboard_relay.runtime_cleanup import cleanup_previous_runtime_artifacts
from clipboard_relay.runtime_paths import get_app_root, get_web_root
from clipboard_relay.web_control.control_center_window_lifecycle import close_browser_processes_by_profile, run_control_center_cleanup_watchdog_from_args


class StartupLogger:
    def __init__(self, root: Path) -> None:
        # 该对象用于让源码模式和打包模式都输出统一启动日志，便于免环境发布后排障。
        self.root = Path(root)
        self.logs_dir = self.root / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.run_log = self.logs_dir / "startup.log"
        self.marker = self.logs_dir / "last_startup.log"
        self.run_log.write_text("", encoding="utf-8")
        self._write_raw(f"[{self._now()}] ========== START ==========")
        self.marker.write_text(str(self.run_log), encoding="utf-8")

    @staticmethod
    def _now() -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _write_raw(self, line: str) -> None:
        with self.run_log.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    def write(self, message: str) -> None:
        # 该函数用于同时写入文件日志和可用控制台，避免无黑窗打包后 stdout 不存在导致启动失败。
        text = f"[{self._now()}] {message}"
        console_stream = getattr(sys, "stdout", None)
        if console_stream is not None and hasattr(console_stream, "write"):
            print(text, flush=True)
        self._write_raw(text)

    def write_block(self, text: str) -> None:
        for line in str(text or "").splitlines():
            self._write_raw(line)


def _is_check_mode(argv: list[str]) -> bool:
    # 该函数用于识别打包自检模式，方便免环境发布后快速验证依赖和资源是否齐全。
    normalized = {str(item or "").strip().lower() for item in argv}
    return "--check" in normalized or "check" in normalized


def _run_check(root: Path, logger: StartupLogger) -> int:
    # 该函数用于验证配置、Playwright 包和网页静态资源是否都能在当前运行时被找到。
    config_path = root / "config.json"
    if not config_path.exists():
        raise RuntimeError(f"未找到配置文件：{config_path}")
    load_config(config_path)
    import playwright  # noqa: F401

    web_root = get_web_root()
    for name in ("index.html", "app.js", "style.css"):
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
    cleanup_previous_runtime_artifacts(root, prepare_browser_profiles=close_browser_processes_by_profile)
    logger = StartupLogger(root)
    try:
        logger.write(f"Workdir: {root}")
        logger.write(f"Executable: {Path(sys.executable).resolve()}")
        if _is_check_mode(args):
            logger.write("Check mode: validate config, playwright and web assets.")
            return _run_check(root, logger)
        logger.write("Start control panel: web control center")
        from clipboard_relay.panel import main as panel_main

        exit_code = int(panel_main())
        logger.write(f"Exit code: {exit_code}")
        return exit_code
    except Exception as exc:
        logger.write(f"ERROR: {exc}")
        logger.write_block(traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
