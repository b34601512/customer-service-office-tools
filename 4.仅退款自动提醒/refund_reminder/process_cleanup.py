#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import ctypes
import os
import subprocess
from pathlib import Path
from typing import Iterable

from .logger import log

_MODULE = "refund_reminder.process_cleanup"
BROWSER_PROCESS_NAMES = ("chrome.exe", "msedge.exe", "chromium.exe", "360chrome.exe", "360se.exe", "qqbrowser.exe")
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259


def _run_powershell(script: str, *, timeout_sec: float = 10) -> str:
    # 该函数仅用于启动/退出时的短查询，脚本保持明文以避免编码命令触发安全软件。
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", str(script)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
        timeout=timeout_sec,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return str(result.stdout or "")


def is_process_running(process_id: int) -> bool:
    # 该函数用于常态查询本次启动记录的固定 PID，不启动 PowerShell 扫描全系统。
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


def _normalize_match_paths(paths: Iterable[str | Path]) -> list[str]:
    # 该函数用于统一整理进程匹配路径，避免查询和清理使用两套路径规则。
    return [str(Path(item)) for item in paths if str(item or "").strip()]


def _build_matching_browser_process_script(needles: list[str], *, action_body: str) -> str:
    # 该函数用于构造同一套浏览器进程筛选条件，让查询和清理不会出现口径分裂。
    needle_lines = "\n".join(needles)
    browser_names = "\n".join(BROWSER_PROCESS_NAMES)
    return f"""
$needles = @'
{needle_lines}
'@ -split "`r?`n" | Where-Object {{ $_ }}
$needleLowers = $needles | ForEach-Object {{ $_.ToLower() }}
$allowedNames = @'
{browser_names}
'@ -split "`r?`n" | Where-Object {{ $_ }} | ForEach-Object {{ $_.ToLower() }}
$currentPid = {os.getpid()}
Get-CimInstance Win32_Process |
  Where-Object {{
    $process = $_
    $nameLower = [string]$process.Name
    $nameLower = $nameLower.ToLower()
    $commandLower = [string]$process.CommandLine
    $commandLower = $commandLower.ToLower()
    $process.ProcessId -ne $currentPid -and
    ($allowedNames -contains $nameLower) -and
    $commandLower -and
    ($needleLowers | Where-Object {{ $_ -and $_.Length -gt 0 -and $commandLower.Contains($_) }}).Count -gt 0
  }} |
  ForEach-Object {{
{action_body}
  }}
"""


def find_process_ids_matching_paths(paths: Iterable[str | Path]) -> list[str]:
    # 该函数用于只查询匹配路径的浏览器进程号，不做清理动作。
    needles = _normalize_match_paths(paths)
    if not needles:
        return []
    script = _build_matching_browser_process_script(needles, action_body="    Write-Output $_.ProcessId")
    return [item.strip() for item in _run_powershell(script).splitlines() if item.strip()]


def stop_processes_matching_paths(paths: Iterable[str | Path], *, action: str) -> list[str]:
    # 该函数用于按命令行路径精准清理本工具打开的进程，不按进程名误杀普通浏览器。
    needles = _normalize_match_paths(paths)
    if not needles:
        return []
    script = _build_matching_browser_process_script(
        needles,
        action_body="""    try {
      Stop-Process -Id $_.ProcessId -Force
      Write-Output $_.ProcessId
    } catch {}""",
    )
    killed = [item.strip() for item in _run_powershell(script).splitlines() if item.strip()]
    if killed:
        log("Process", action, _MODULE, "stop_processes_matching_paths", paths=";".join(needles), pids=",".join(killed))
    return killed


__all__ = ["find_process_ids_matching_paths", "is_process_running", "stop_processes_matching_paths"]
