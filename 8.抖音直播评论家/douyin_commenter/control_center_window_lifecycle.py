#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from .logger import log

_MODULE = "douyin_commenter.control_center_window_lifecycle"
_MONITOR_INTERVAL_SECONDS = 1.0
_MISSING_WINDOW_TICKS_BEFORE_EXIT = 5
_WATCHDOG_MODE_ARGUMENT = "--control-center-cleanup-watchdog"
_GRACEFUL_SHUTDOWN_TIMEOUT_SECONDS = 8.0
_BROWSER_PROCESS_NAMES = ("chrome.exe", "msedge.exe", "chromium.exe", "360chrome.exe", "360se.exe", "qqbrowser.exe")
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259


def _run_powershell(script: str, *, timeout_seconds: float = 10) -> str:
    # 该函数仅用于启动/退出时的短查询，脚本保持明文以避免编码命令触发安全软件。
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", str(script)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
        timeout=timeout_seconds,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode != 0:
        raise RuntimeError(str(result.stderr or result.stdout or f"PowerShell退出码={result.returncode}").strip())
    return str(result.stdout or "")


@dataclass(frozen=True)
class ControlCenterBrowserHandle:
    # 该对象是本次后台窗口的唯一身份，常态监控不再通过资料目录猜测进程。
    profile_dir: Path
    process_id: int


def is_process_running(process_id: int) -> bool:
    # 该函数只查询已记录 PID，不启动 PowerShell 扫描全系统。
    pid = int(process_id)
    if pid <= 0:
        return False
    if os.name == "nt":
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            exit_code = ctypes.c_ulong()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))) and int(exit_code.value) == _STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _normalize_profile_paths(profile_paths: Iterable[Path]) -> list[str]:
    # 该函数用于统一整理资料目录列表，避免看门狗和清理函数使用不同口径。
    return [str(Path(item)) for item in profile_paths if str(item or "").strip()]


def find_browser_process_ids_by_profiles(profile_paths: Iterable[Path]) -> list[str]:
    # 该函数用于按独立资料目录查找本工具浏览器进程，不按进程名粗暴误伤。
    profiles = _normalize_profile_paths(profile_paths)
    if not profiles:
        return []
    profile_lines = "\n".join(profiles)
    browser_names = "\n".join(_BROWSER_PROCESS_NAMES)
    script = f"""
$profiles = @'
{profile_lines}
'@ -split "`r?`n" | Where-Object {{ $_ }}
$allowedNames = @'
{browser_names}
'@ -split "`r?`n" | Where-Object {{ $_ }} | ForEach-Object {{ $_.ToLower() }}
$profileLowers = $profiles | ForEach-Object {{ $_.ToLower() }}
Get-CimInstance Win32_Process |
  Where-Object {{
    $nameLower = [string]$_.Name
    $nameLower = $nameLower.ToLower()
    $commandLower = [string]$_.CommandLine
    $commandLower = $commandLower.ToLower()
    ($allowedNames -contains $nameLower) -and
    $commandLower -and
    ($profileLowers | Where-Object {{ $_ -and $_.Length -gt 0 -and $commandLower.Contains($_) }}).Count -gt 0
  }} |
  ForEach-Object {{ Write-Output $_.ProcessId }}
"""
    return [item.strip() for item in _run_powershell(script).splitlines() if item.strip()]


def find_browser_process_ids_by_profile(user_data_dir: Path) -> list[str]:
    # 该函数用于按一个资料目录查找本工具浏览器进程，保留给单目录调用方使用。
    return find_browser_process_ids_by_profiles([Path(user_data_dir)])


def _build_cleanup_watchdog_command(*, parent_pid: int, control_browser_pid: int, shutdown_url: str) -> list[str]:
    # 该函数用于让源码和打包程序都重新进入自身的纯 Python 看门狗模式。
    command = [str(sys.executable)]
    if not getattr(sys, "frozen", False):
        command.append(str(Path(__file__).resolve().parents[1] / "app_entry.py"))
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


def _stop_browser_process_ids(process_ids: list[str]) -> list[str]:
    # 该函数用于按进程号关闭已确认属于本工具资料目录的浏览器进程。
    if not process_ids:
        return []
    process_id_lines = "\n".join(str(item) for item in process_ids)
    script = f"""
$processIds = @'
{process_id_lines}
'@ -split "`r?`n" | Where-Object {{ $_ }} | ForEach-Object {{ [int]$_ }}
foreach ($targetPid in $processIds) {{
  try {{
    Stop-Process -Id $targetPid -Force
    Write-Output $targetPid
  }} catch {{}}
}}
"""
    return [item.strip() for item in _run_powershell(script).splitlines() if item.strip()]


def close_browser_processes_by_profile(user_data_dir: Path) -> None:
    # 该函数用于关闭本工具控制台窗口，点击退出和服务收尾都只走这一处。
    killed = _stop_browser_process_ids(find_browser_process_ids_by_profile(user_data_dir))
    if killed:
        log("Web", "清理后台浏览器", _MODULE, "close_browser_processes_by_profile", profile=str(user_data_dir), pids=",".join(killed))


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
    "find_browser_process_ids_by_profile",
    "find_browser_process_ids_by_profiles",
    "run_control_center_cleanup_watchdog_from_args",
    "start_control_center_cleanup_watchdog",
    "start_control_center_window_lifecycle_monitor",
]
