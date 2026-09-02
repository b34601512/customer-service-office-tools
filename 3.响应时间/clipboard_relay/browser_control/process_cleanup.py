#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path

from ..process_management import terminate_processes_matching_path


def kill_processes_matching_path(path: Path) -> list[str]:
    # 该函数保留浏览器控制层旧入口，实际清理统一交给进程管理模块。
    return terminate_processes_matching_path(Path(path))


__all__ = ["kill_processes_matching_path"]
