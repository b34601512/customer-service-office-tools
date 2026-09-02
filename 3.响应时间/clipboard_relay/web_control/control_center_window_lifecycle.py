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
from typing import Callable, Iterable

from ..logger import log
from ..process_management import find_browser_process_ids_by_profiles, is_process_running, stop_process_ids

_MODULE = "clipboard_relay.web_control.control_center_window_lifecycle"
_MONITOR_INTERVAL_SECONDS = 1.0
_MISSING_WINDOW_TICKS_BEFORE_EXIT = 5
_WATCHDOG_MODE_ARGUMENT = "--control-center-cleanup-watchdog"
_GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS = 8.0


@dataclass(frozen=True)
class ControlCenterBrowserHandle:
    # 该对象用于记录本次后台窗口身份，常态监控只看这个 PID，不再扫全电脑。
    profile_dir: Path
    process_id: int


def _build_cleanup_watchdog_command(*, parent_pid: int, control_browser_pid: int, shutdown_url: str) -> list[str]:
    # 该函数用于让源码和打包程序都能重新进入自身的纯 Python 看门狗模式。
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
    # 该函数用于先请求主程序走正常退出流程，失败时再由看门狗按固定 PID 收尾。
    request = urllib.request.Request(str(shutdown_url), data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=2.0):
            return
    except Exception:
        return


def _terminate_process(process_id: int, *, include_children: bool) -> None:
    # 该函数只结束已记录 PID；浏览器允许连同子进程清理，父程序只结束自身以免误伤看门狗。
    pid = int(process_id)
    if pid <= 0:
        return
    if os.name == "nt":
        command = ["taskkill.exe", "/PID", str(pid)]
        if include_children:
            command.append("/T")
        command.append("/F")
        subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return
    try:
        os.kill(pid, 15)
    except OSError:
        return


def run_control_center_cleanup_watchdog(*, parent_pid: int, control_browser_pid: int, shutdown_url: str) -> int:
    # 该函数是纯 Python 外部看门狗：循环只查询两个固定 PID，不读取全系统命令行。
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
    # 该函数用于入口在正常初始化前识别看门狗子进程，避免子进程再次启动完整后台。
    if _WATCHDOG_MODE_ARGUMENT not in argv:
        return None
    try:
        parent_pid = int(argv[argv.index("--parent-pid") + 1])
        control_browser_pid = int(argv[argv.index("--control-browser-pid") + 1])
        shutdown_url = str(argv[argv.index("--shutdown-url") + 1])
    except (ValueError, IndexError) as exc:
        raise RuntimeError("控制台清理看门狗参数不完整。") from exc
    return run_control_center_cleanup_watchdog(
        parent_pid=parent_pid,
        control_browser_pid=control_browser_pid,
        shutdown_url=shutdown_url,
    )


def start_control_center_cleanup_watchdog(
    browser_handle: ControlCenterBrowserHandle,
    *,
    shutdown_url: str,
) -> int:
    # 该函数用于启动纯 Python 外部看门狗，主程序异常消失后仍能按记录 PID 收尾。
    command = _build_cleanup_watchdog_command(
        parent_pid=os.getpid(),
        control_browser_pid=int(browser_handle.process_id),
        shutdown_url=shutdown_url,
    )
    process = subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0),
        close_fds=True,
    )
    log(
        "Web",
        "启动外部清理看门狗",
        _MODULE,
        "start_control_center_cleanup_watchdog",
        parent_pid=os.getpid(),
        watchdog_pid=process.pid,
        control_browser_pid=browser_handle.process_id,
        profile=str(browser_handle.profile_dir),
    )
    return int(process.pid or 0)


def _stop_browser_processes_until_released(
    profile_paths: Iterable[Path],
    *,
    timeout_seconds: float = 8.0,
    poll_interval_seconds: float = 0.25,
) -> tuple[list[str], list[str]]:
    # 该函数用于退出兜底时反复关闭本工具资料目录浏览器，直到 Windows 释放文件锁。
    paths = [Path(item) for item in profile_paths]
    deadline = time.monotonic() + max(0.5, float(timeout_seconds))
    killed: list[str] = []
    remaining: list[str] = []
    while True:
        process_ids = find_browser_process_ids_by_profiles(paths)
        if not process_ids:
            time.sleep(0.5)
            return killed, []
        remaining = process_ids
        killed.extend(stop_process_ids(process_ids))
        if time.monotonic() >= deadline:
            return killed, remaining
        time.sleep(max(0.05, float(poll_interval_seconds)))


def close_browser_processes_by_profile(user_data_dir: Path) -> None:
    # 该函数用于按资料目录兜底关闭本工具控制台窗口，只在启动/退出清理时调用。
    profile = str(Path(user_data_dir))
    killed, remaining = _stop_browser_processes_until_released([Path(user_data_dir)])
    if killed:
        unique_killed = sorted(set(killed), key=str)
        log("Web", "清理后台浏览器", _MODULE, "close_browser_processes_by_profile", profile=profile, pids=",".join(unique_killed))
    if remaining:
        log("Web", "后台浏览器仍未释放", _MODULE, "close_browser_processes_by_profile", profile=profile, pids=",".join(remaining))


def _is_control_center_browser_running(browser_handle: ControlCenterBrowserHandle) -> bool:
    # 该函数用于常态判断后台窗口是否还活着，只查本次启动时记录的 PID。
    return is_process_running(int(browser_handle.process_id))


def _monitor_control_center_window(*, service: object, browser_handle: ControlCenterBrowserHandle, stop_event: threading.Event) -> None:
    # 该函数用于发现用户直接关闭后台窗口后，触发退出按钮同一条清理流程。
    has_seen_control_window = False
    missing_control_window_ticks = 0
    while not stop_event.wait(_MONITOR_INTERVAL_SECONDS):
        if getattr(service, "shutdown_event").is_set():
            return
        try:
            control_window_running = _is_control_center_browser_running(browser_handle)
        except Exception as exc:
            log("Web", "后台窗口监控失败", _MODULE, "_monitor_control_center_window", profile=str(browser_handle.profile_dir), reason=str(exc))
            service._append_log(f"后台窗口监控失败：{exc}")
            return
        if control_window_running:
            has_seen_control_window = True
            missing_control_window_ticks = 0
            continue
        if not has_seen_control_window:
            continue
        missing_control_window_ticks += 1
        if missing_control_window_ticks < _MISSING_WINDOW_TICKS_BEFORE_EXIT:
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
    "find_browser_process_ids_by_profiles",
    "run_control_center_cleanup_watchdog_from_args",
    "start_control_center_cleanup_watchdog",
    "start_control_center_window_lifecycle_monitor",
]
