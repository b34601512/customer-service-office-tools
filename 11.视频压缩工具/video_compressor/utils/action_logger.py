from __future__ import annotations

import inspect
from datetime import datetime
from pathlib import Path
from typing import Callable

from video_compressor.utils.runtime_paths import get_resource_root

PROJECT_ROOT = get_resource_root()
LOG_LISTENERS: list[Callable[[str], None]] = []


def register_log_listener(listener: Callable[[str], None]) -> None:
    """注册日志监听器，让 GUI 可以同步接收终端日志。"""
    LOG_LISTENERS.append(listener)


def unregister_log_listener(listener: Callable[[str], None]) -> None:
    """移除日志监听器，避免窗口关闭后还有后台回调残留。"""
    if listener in LOG_LISTENERS:
        LOG_LISTENERS.remove(listener)


def log_action(main_action: str, module_name: str, sub_action: str, message: str = "") -> str:
    """按统一格式打印中文日志，方便后续定位动作链路。"""
    caller_frame = inspect.currentframe()
    file_label = "未知文件:0"

    if caller_frame is not None and caller_frame.f_back is not None:
        source_frame = caller_frame.f_back
        source_path = Path(source_frame.f_code.co_filename).resolve()
        try:
            relative_path = source_path.relative_to(PROJECT_ROOT).as_posix()
        except ValueError:
            relative_path = source_path.name
        file_label = f"{relative_path}:{source_frame.f_lineno}"

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}][{file_label}][{main_action}][{module_name}][{sub_action}]"
    if message:
        line = f"{line} {message}"

    print(line, flush=True)
    for listener in list(LOG_LISTENERS):
        listener(line)

    return line
