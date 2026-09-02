#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import traceback
from pathlib import Path

from douyin_commenter.config import load_config
from douyin_commenter.control_center_window_lifecycle import run_control_center_cleanup_watchdog_from_args
from douyin_commenter.logger import init_logging, log
from douyin_commenter.runtime_paths import get_app_root, get_web_root

_MODULE = "app_entry"


def _is_check_mode(argv: list[str]) -> bool:
    # 该函数用于识别自检模式，方便不启动浏览器也能验证配置和资源。
    normalized_args = {str(item or "").strip().lower() for item in argv}
    return "--check" in normalized_args or "check" in normalized_args


def _run_check(root_dir: Path) -> int:
    # 该函数用于验证配置、Playwright 包和网页静态资源是否齐全。
    config = load_config(root_dir / "config.json")
    import playwright  # noqa: F401

    web_root = get_web_root()
    for file_name in ("index.html", "app.js", "style.css"):
        asset_path = web_root / file_name
        if not asset_path.exists():
            raise RuntimeError(f"未找到网页资源：{asset_path}")
    log("Startup", "自检完成", _MODULE, "_run_check", rooms=len(config.live_rooms), comments=len(config.comments))
    print("CHECK_OK", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    # 该函数用于提供源码和打包后的统一入口。
    args = list(sys.argv[1:] if argv is None else argv)
    watchdog_exit_code = run_control_center_cleanup_watchdog_from_args(args)
    if watchdog_exit_code is not None:
        return int(watchdog_exit_code)
    root_dir = get_app_root()
    init_logging(root_dir)
    try:
        log("Startup", "启动", _MODULE, "main", root=str(root_dir), executable=str(Path(sys.executable).resolve()))
        if _is_check_mode(args):
            return _run_check(root_dir)
        from douyin_commenter.panel import main as panel_main

        return int(panel_main())
    except Exception as exc:
        log("Startup", "启动失败", _MODULE, "main.failed", reason=str(exc))
        log("Startup", "异常堆栈", _MODULE, "main.traceback", traceback=traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
