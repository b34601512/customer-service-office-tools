"""该文件负责统一日志格式，让每个模块只调用一个日志出口。"""
from __future__ import annotations

import inspect
import traceback
from datetime import datetime
from pathlib import Path

from .paths import LOG_FILE


def write_log(main_action: str, module_name: str, sub_action: str) -> None:
    """用统一格式记录关键动作到日志文件，方便定位本次运行的真实流程。

    只写文件、不打印到控制台：TUI 全屏界面下后台线程打日志会漏到画面里。
    """
    frame = inspect.currentframe()
    caller = frame.f_back if frame else None
    line_number = caller.f_lineno if caller else 0
    file_name = Path(caller.f_code.co_filename).name if caller else "unknown"
    timestamp = datetime.now().strftime("%H:%M:%S")
    message = f"[{timestamp}][{file_name}:{line_number}][主线:{main_action}][{module_name}][{sub_action}]"
    with LOG_FILE.open("a", encoding="utf-8") as log_file:
        log_file.write(message + "\n")


def write_error_log(main_action: str, module_name: str, error: BaseException) -> None:
    """记录完整异常，避免后台维护失败后静默吞掉真实原因。"""
    write_log(main_action, module_name, f"{type(error).__name__}: {error}")
    error_trace = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    with LOG_FILE.open("a", encoding="utf-8") as log_file:
        log_file.write(error_trace + "\n")
