#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..logger import log
from ..process_cleanup import is_process_running, stop_processes_matching_paths

_MODULE = "refund_reminder.web_control.control_center_window_lifecycle"
_MONITOR_INTERVAL_SECONDS = 1.0
_MISSING_WINDOW_TICKS_BEFORE_EXIT = 5
_WATCHDOG_MODE_ARGUMENT = "--control-center-cleanup-watchdog"
_GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS = 8.0


@dataclass(frozen=True)
class ControlCenterBrowserHandle:
    # 该对象是本次后台窗口的唯一身份，常态监控不再用资料目录猜测进程。
    profile_dir: Path
    process_id: int


def close_browser_processes_by_profile(user_data_dir: Path) -> None:
    # 该函数用于按后台浏览器资料目录清理进程，只处理本工具打开的窗口。
    killed = stop_processes_matching_paths([user_data_dir], action="清理后台浏览器")
    if killed:
        log("Web", "清理后台浏览器", _MODULE, "close_browser_processes_by_profile", profile=str(user_data_dir), pids=",".join(killed))


def _build_cleanup_watchdog_command(*, parent_pid: int, control_browser_pid: int, shutdown_url: str) -> list[str]:
    # 该函数用于让源码和打包程序都重新进入自身的纯 Python 看门狗模式。
    command = [str(sys.executable)]
    if not getattr(sys, "frozen", False):
        command.append(str(Path(__file__).resolve().parents[2] / "app_entry.py"))
    command.extend(
        [
            _WATCHDOG_MODE_ARGUMENT,
            "--parent-pid",
            str(int(parent_pid)),
            "--control-browser-pid",
            str(int(control_browser_pid)),
            "--shutdown-url",
            str(shutdown_url),
        ]
    )
    return command


def _request_graceful_shutdown(shutdown_url: str) -> None:
    request = urllib.request.Request(str(shutdown_url), data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=2.0):
            return
    except Exception:
        return


def _terminate_process(process_id: int, *, include_children: bool) -> None:
    # 该函数只结束已记录 PID；父程序不带 /T，避免结束它的看门狗子进程。
    pid = int(process_id)
    if pid <= 0:
        return
    if os.name == "nt":
        command = ["taskkill.exe", "/PID", str(pid)]
        if include_children:
            command.append("/T")
        command.append("/F")
        subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return
    try:
        os.kill(pid, 15)
    except OSError:
        return


def run_control_center_cleanup_watchdog(*, parent_pid: int, control_browser_pid: int, shutdown_url: str) -> int:
    # 该函数的常态循环只查询父进程和本次后台浏览器两个固定 PID。
    has_seen_control_window = False
    missing_control_window_ticks = 0
    while True:
        parent_running = is_process_running(parent_pid)
        control_window_running = is_process_running(control_browser_pid)
        if control_window_running:
            has_seen_control_window = True
            missing_control_window_ticks = 0
        elif has_seen_control_window:
            missing_control_window_ticks += 1
        if not parent_running:
            _terminate_process(control_browser_pid, include_children=True)
            return 0
        if has_seen_control_window and not control_window_running and missing_control_window_ticks >= _MISSING_WINDOW_TICKS_BEFORE_EXIT:
            _request_graceful_shutdown(shutdown_url)
            deadline = time.monotonic() + _GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS
            while is_process_running(parent_pid) and time.monotonic() < deadline:
                time.sleep(0.2)
            if is_process_running(parent_pid):
                _terminate_process(parent_pid, include_children=False)
            _terminate_process(control_browser_pid, include_children=True)
            return 0
        time.sleep(_MONITOR_INTERVAL_SECONDS)


def run_control_center_cleanup_watchdog_from_args(argv: list[str]) -> int | None:
    # 该函数供统一入口在正常初始化前分流看门狗子进程。
    if _WATCHDOG_MODE_ARGUMENT not in argv:
        return None
    try:
        parent_pid = int(argv[argv.index("--parent-pid") + 1])
        control_browser_pid = int(argv[argv.index("--control-browser-pid") + 1])
        shutdown_url = str(argv[argv.index("--shutdown-url") + 1])
    except (ValueError, IndexError) as exc:
        raise RuntimeError("控制台清理看门狗参数不完整。") from exc
    return run_control_center_cleanup_watchdog(parent_pid=parent_pid, control_browser_pid=control_browser_pid, shutdown_url=shutdown_url)


def start_control_center_cleanup_watchdog(browser_handle: ControlCenterBrowserHandle, *, shutdown_url: str) -> int:
    # 该函数启动纯 Python 外部看门狗，主程序异常消失后仍能精确收尾浏览器树。
    parent_pid = os.getpid()
    process = subprocess.Popen(
        _build_cleanup_watchdog_command(parent_pid=parent_pid, control_browser_pid=browser_handle.process_id, shutdown_url=shutdown_url),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0),
        close_fds=True,
    )
    log("Web", "启动外部清理看门狗", _MODULE, "start_control_center_cleanup_watchdog", parent_pid=parent_pid, watchdog_pid=process.pid, control_browser_pid=browser_handle.process_id, profile=str(browser_handle.profile_dir))
    return int(process.pid or 0)


def _monitor_control_center_window(*, service: object, browser_handle: ControlCenterBrowserHandle, stop_event: threading.Event) -> None:
    # 该函数用于发现用户直接关闭后台窗口后，触发退出按钮同一条清理流程。
    has_seen_control_window = False
    while not stop_event.wait(_MONITOR_INTERVAL_SECONDS):
        if getattr(service, "shutdown_event").is_set():
            return
        try:
            control_window_running = is_process_running(browser_handle.process_id)
            if control_window_running:
                has_seen_control_window = True
                continue
        except Exception as exc:
            log("Web", "后台窗口监控失败", _MODULE, "_monitor_control_center_window", profile=str(browser_handle.profile_dir), reason=str(exc))
            service._append_log(f"后台窗口监控失败：{exc}")
            return
        if not has_seen_control_window:
            continue
        log("Web", "后台窗口已关闭", _MODULE, "_monitor_control_center_window", profile=str(browser_handle.profile_dir), control_browser_pid=browser_handle.process_id)
        service._append_log("检测到后台网页窗口已关闭，正在按退出按钮同一流程退出。")
        service.exit_all()
        return


def start_control_center_window_lifecycle_monitor(*, service: object, browser_handle: ControlCenterBrowserHandle) -> Callable[[], None]:
    # 该函数用于启动后台窗口生命周期监控，并返回停止监控的函数给主流程收尾调用。
    stop_event = threading.Event()
    thread = threading.Thread(
        target=_monitor_control_center_window,
        kwargs={"service": service, "browser_handle": browser_handle, "stop_event": stop_event},
        name="control-center-window-lifecycle",
        daemon=True,
    )
    thread.start()
    return stop_event.set


__all__ = [
    "ControlCenterBrowserHandle",
    "close_browser_processes_by_profile",
    "run_control_center_cleanup_watchdog_from_args",
    "start_control_center_cleanup_watchdog",
    "start_control_center_window_lifecycle_monitor",
]
