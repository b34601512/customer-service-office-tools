#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import ctypes
import os
import subprocess
from pathlib import Path
from typing import Iterable

_BROWSER_PROCESS_NAMES = ("chrome.exe", "msedge.exe", "chromium.exe", "360chrome.exe", "360se.exe", "qqbrowser.exe")
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259


def _run_powershell(script: str, *, timeout_seconds: float = 10) -> str:
    # 该函数仅用于启动/退出时的短查询；脚本保持明文，避免编码命令触发安全软件。
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", str(script)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        timeout=timeout_seconds,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode != 0:
        raise RuntimeError(str(result.stderr or result.stdout or f"PowerShell退出码={result.returncode}").strip())
    return str(result.stdout or "")

def _normalize_profile_paths(profile_paths: Iterable[Path]) -> list[str]:
    # 该函数用于把资料目录统一成 PowerShell 可消费的非空字符串列表。
    return [str(Path(item)) for item in profile_paths if str(item or "").strip()]


def _normalize_process_ids(process_ids: Iterable[int | str]) -> list[int]:
    # 该函数用于过滤无效 PID，避免 Stop-Process 收到空值或负数。
    normalized: list[int] = []
    for item in process_ids:
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if value > 0:
            normalized.append(value)
    return normalized


def _is_process_running_with_windows_api(process_id: int) -> bool:
    # 该函数用于用 Windows API 查询固定 PID，避免每秒启动 PowerShell 扫全电脑。
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, int(process_id))
    if not handle:
        return False
    try:
        exit_code = ctypes.c_ulong()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return False
        return int(exit_code.value) == _STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def is_process_running(process_id: int | str) -> bool:
    # 该函数用于判断一个已知 PID 是否存活，服务常态监控而不是全系统扫描。
    ids = _normalize_process_ids([process_id])
    if not ids:
        return False
    pid = ids[0]
    if os.name == "nt":
        return _is_process_running_with_windows_api(pid)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def find_browser_process_ids_by_profiles(profile_paths: Iterable[Path]) -> list[str]:
    # 该函数只用于启动/退出兜底：按资料目录找本工具浏览器，禁止放进每秒常态监控。
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


def stop_process_ids(process_ids: Iterable[int | str]) -> list[str]:
    # 该函数用于关闭已确认属于本工具的 PID，不按进程名粗暴清理。
    ids = _normalize_process_ids(process_ids)
    if not ids:
        return []
    process_id_lines = "\n".join(str(item) for item in ids)
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


def terminate_processes_matching_path(path: Path) -> list[str]:
    # 该函数用于退出兜底：按资料目录路径清理残留浏览器，避免误杀用户普通浏览器。
    return stop_process_ids(find_browser_process_ids_by_profiles([Path(path)]))


__all__ = [
    "find_browser_process_ids_by_profiles",
    "is_process_running",
    "stop_process_ids",
    "terminate_processes_matching_path",
]
