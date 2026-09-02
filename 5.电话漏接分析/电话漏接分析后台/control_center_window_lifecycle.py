#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterable


def _run_powershell(script: str, *, timeout_seconds: float = 10) -> str:
    """仅在启动/退出时执行明文短查询，避免编码脚本触发安全软件。"""
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
    """统一整理需要在启动或退出时清理的浏览器资料目录。"""
    return [str(Path(item)) for item in profile_paths if str(item or "").strip()]


def find_browser_process_ids_by_profiles(profile_paths: Iterable[Path]) -> list[str]:
    """按独立资料目录查找本工具浏览器进程，不按进程名粗暴误伤。"""
    profiles = _normalize_profile_paths(profile_paths)
    if not profiles:
        return []
    process_ids: list[str] = []
    browser_name_pattern = "chrome|msedge|chromium|360chrome|360se|qqbrowser"
    for profile_path in profiles:
        script = (
            f'$p="{profile_path}";$n="{browser_name_pattern}";'
            'Get-CimInstance Win32_Process|?{$_.Name -match $n -and $_.CommandLine '
            '-and $_.CommandLine.ToLower().Contains($p.ToLower())}|%{$_.ProcessId}'
        )
        process_ids.extend(item.strip() for item in _run_powershell(script).splitlines() if item.strip())
    return list(dict.fromkeys(process_ids))


def _stop_browser_process_ids(process_ids: list[str]) -> list[str]:
    """按进程号关闭已确认属于本工具资料目录的浏览器进程。"""
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


def close_browser_processes_by_profiles(profile_paths: Iterable[Path]) -> list[str]:
    """关闭本工具资料目录匹配到的浏览器进程，并返回实际关闭的进程号。"""
    return _stop_browser_process_ids(find_browser_process_ids_by_profiles(profile_paths))
