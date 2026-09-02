#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import inspect
import time
from pathlib import Path
from typing import Any


def log(main_action: str, module_name: str, sub_action: str, **fields: Any) -> None:
    # 该函数用于打包脚本输出统一中文日志，失败时能直接定位文件和行号。
    frame = inspect.stack()[1]
    location = f"{Path(frame.filename).name}:{frame.lineno}"
    detail = " ".join(f"{key}={value!r}" for key, value in fields.items())
    suffix = f" {detail}" if detail else ""
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}][{location}][主线:{main_action}][{module_name}][{sub_action}]{suffix}", flush=True)


__all__ = ["log"]
