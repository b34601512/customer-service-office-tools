#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..logger import log
from .logging_utils import _MODULE
from .title_matcher import _is_browser_already_closed_error


def _close_target(self, contexts: dict[str, Any], pages: dict[str, Any], target_keys_by_name: dict[str, str], target_key: str) -> None:
    # 该函数用于关闭指定目标旧页面，保证同一目标不会残留两个受控窗口。
    context = contexts.pop(str(target_key), None)
    pages.pop(str(target_key), None)
    for name, key in list(target_keys_by_name.items()):
        if key == str(target_key):
            target_keys_by_name.pop(name, None)
    if context is not None:
        try:
            context.close()
            log("Browser", "关闭旧受控浏览器", _MODULE, "_close_target", target_key=target_key)
        except BaseException as exc:
            if not _is_browser_already_closed_error(exc):
                raise
            log("Browser", "旧受控浏览器已被手动关闭", _MODULE, "_close_target.already_closed", target_key=target_key, reason=str(exc))


def _close_stale_profile_processes(self, user_data_dir: Path) -> None:
    # 该函数用于清理旧版本崩溃后残留的本项目专用浏览器进程，不触碰用户普通浏览器。
    killed = self._kill_processes_matching_path(user_data_dir)
    if killed:
        log("Browser", "清理残留受控浏览器", _MODULE, "_close_stale_profile_processes", profile=str(Path(user_data_dir)), pids=",".join(killed))


def _close_contexts(self, contexts: dict[str, Any]) -> None:
    # 该函数用于关闭当前控制线程持有的全部浏览器上下文。
    for key, context in list(contexts.items()):
        try:
            context.close()
            log("Browser", "关闭受控浏览器", _MODULE, "_close_contexts", target_key=key)
        except BaseException as exc:
            log("Browser", "关闭受控浏览器失败", _MODULE, "_close_contexts.failed", target_key=key, reason=str(exc))
        finally:
            contexts.pop(key, None)


__all__ = ["_close_target", "_close_stale_profile_processes", "_close_contexts"]
