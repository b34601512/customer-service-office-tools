"""该文件负责浏览器窗口和本地服务生命周期，避免接口层直接管理进程。"""
from __future__ import annotations

import threading

from control_center_window_lifecycle import close_browser_processes_by_profiles

from .logging_utils import write_log
from .paths import DOWNLOAD_BROWSER_PROFILE_DIR

# 启动清理与下载任务共用下载浏览器 profile：启动清理线程会关闭残留浏览器进程，
# 下载任务必须先等清理完成再启动浏览器，否则清理线程会把下载中的浏览器误杀，
# 表现为“只下载一个文件就自动断开”。默认已完成，未启动清理时无需等待。
STARTUP_CLEANUP_DONE = threading.Event()
STARTUP_CLEANUP_DONE.set()


def begin_startup_cleanup() -> None:
    """标记启动清理开始，下载任务在此期间需要等待。"""
    STARTUP_CLEANUP_DONE.clear()


def mark_startup_cleanup_done() -> None:
    """标记启动清理完成，下载任务可以启动浏览器。"""
    STARTUP_CLEANUP_DONE.set()


def wait_startup_cleanup(timeout: float = 60) -> None:
    """等待启动清理完成；未启动清理或已完成的场景立即返回。"""
    STARTUP_CLEANUP_DONE.wait(timeout)


def close_download_browser_windows() -> None:
    """关闭自动下载引擎独立资料目录打开的浏览器进程。"""
    closed_process_ids = close_browser_processes_by_profiles([DOWNLOAD_BROWSER_PROFILE_DIR])
    if closed_process_ids:
        write_log("清理窗口", "自动下载浏览器", f"已关闭 {len(closed_process_ids)} 个进程")
