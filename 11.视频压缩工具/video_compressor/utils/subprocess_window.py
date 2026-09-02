from __future__ import annotations

import os
import subprocess


def get_hidden_process_kwargs() -> dict[str, object]:
    """在 Windows 下让子进程静默启动，避免 ffmpeg 弹出黑色控制台窗口。"""
    if os.name != "nt":
        return {}

    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE

    return {
        "startupinfo": startupinfo,
        "creationflags": subprocess.CREATE_NO_WINDOW,
    }
