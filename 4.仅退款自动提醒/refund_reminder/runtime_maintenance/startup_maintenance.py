# 该文件用于在程序启动入口自动处理历史膨胀和残留进程。
from __future__ import annotations

from pathlib import Path

from ..logger import log
from ..process_cleanup import stop_processes_matching_paths
from .browser_cache_cleaner import BrowserCacheCleanupReport, clean_browser_profile_cache
from .runtime_layout import build_runtime_layout

MODULE_NAME = "refund_reminder.runtime_maintenance.startup_maintenance"


def run_runtime_startup_maintenance(project_root: Path) -> BrowserCacheCleanupReport:
    # 该函数用于在后台启动前清理残留受控浏览器和可重建缓存，避免历史膨胀拖慢本次运行。
    layout = build_runtime_layout(Path(project_root))
    stopped = stop_processes_matching_paths([layout.browser_profiles_dir], action="启动前清理残留受控浏览器")
    if stopped:
        log("Runtime", "启动前清理残留受控浏览器", MODULE_NAME, "run_runtime_startup_maintenance", pids=",".join(stopped))
    report = clean_browser_profile_cache(layout.browser_profiles_dir)
    if report.removed_count:
        log(
            "Runtime",
            "启动前处理运行膨胀",
            MODULE_NAME,
            "run_runtime_startup_maintenance",
            removed_count=report.removed_count,
            removed_bytes=report.removed_bytes,
        )
    return report


__all__ = ["run_runtime_startup_maintenance"]
