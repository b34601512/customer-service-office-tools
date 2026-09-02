#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import queue
import threading
from pathlib import Path
from typing import Any

from ...browser_control import BrowserControl
from ...config import load_config
from ...logger import log
from ...usage_history import record_software_open
from .config_saver import save_buyer_urls, save_credentials, save_form
from .constants import _MODULE
from .hotkeys import ControlHotkeys
from .login_targets import (
    _cancel_manual_login_watchers,
    _get_login_target_spec,
    _handle_login_message,
    _login_worker,
    _refresh_manual_login_overall_state,
    _refresh_ready_from_open_pages,
    _start_manual_login_watch,
    _watch_manual_login_target,
    open_login_target,
    start_login_flow,
)
from .runtime_control import (
    _ensure_relay_thread,
    _exit_worker,
    _handle_controller_status,
    _is_relay_thread_alive,
    _run_controller,
    _start_hotkey_watcher,
    exit_all,
    open_startup_log_file,
    pause_resume,
    start_or_resume,
    stop_all,
)
from .runtime_maintenance import _run_runtime_maintenance_once, _start_runtime_maintenance_watcher
from .snapshots import (
    _append_log,
    _format_main_status,
    _main_indicator_state,
    _refresh_credential_indicators,
    _refresh_temp_indicator,
    _set_indicator,
    _set_main_status,
    get_form_state,
    get_snapshot,
)


class ControlCenterService:
    def __init__(self, *, config_path: Path) -> None:
        # 该服务用于把网页后台、浏览器控制和主流程调度收口到一个状态中心。
        self.config_path = Path(config_path)
        self.config = load_config(self.config_path)
        self.usage_history = record_software_open(self.config_path.parent)
        log("Web", "记录使用日期", _MODULE, "__init__", previous=self.usage_history["previousUsedDate"] or "首次记录", current=self.usage_history["currentUsedDate"])
        self.browser_profile_root = self.config_path.parent / "runtime" / "browser_profiles"
        self.browser = BrowserControl(profile_root=self.browser_profile_root, login_flow=self.config.login_flow)
        self.panel_hotkeys = ControlHotkeys()
        self.stop_event = threading.Event()
        self.shutdown_event = threading.Event()
        self.ready = False
        self.login_running = False
        self.exiting = False
        self.relay_thread: threading.Thread | None = None
        self.login_thread: threading.Thread | None = None
        self._lock = threading.RLock()
        self._subscribers: list[queue.Queue[tuple[str, dict[str, Any]]]] = []
        self._manual_login_tokens = {"service": 0, "web": 0}
        self._manual_login_threads: dict[str, threading.Thread] = {}
        self.log_lines: list[str] = []
        self.status_phase = "待命"
        self.status_remaining_sec: int | None = None
        self.completed_rounds = 0
        self.total_rounds = int(self.config.rounds)
        self.indicators: dict[str, dict[str, str]] = {
            "service": {"title": "咚咚客服端", "state": "idle", "detail": ""},
            "web": {"title": "买家客户端", "state": "idle", "detail": ""},
            "main": {"title": "主流程", "state": "idle", "detail": ""},
            "temp": {"title": "内容引擎", "state": "idle", "detail": ""},
            "browser": {"title": "浏览器控制", "state": "idle", "detail": ""},
        }
        self._refresh_temp_indicator()
        self._refresh_credential_indicators()
        self._set_indicator("main", "idle", self._format_main_status())
        self._set_indicator("browser", "idle", "浏览器控制线程尚未启动；只会控制本工具打开的独立浏览器。")
        self._append_log("后台已待命。请先点「准备网页登录」，确认两个网页就绪后再点「启动」。")
        self._start_runtime_maintenance_watcher()
        self._start_hotkey_watcher()

    def subscribe(self) -> queue.Queue[tuple[str, dict[str, Any]]]:
        # 该函数用于给 SSE 客户端创建订阅队列。
        channel: queue.Queue[tuple[str, dict[str, Any]]] = queue.Queue()
        with self._lock:
            self._subscribers.append(channel)
        return channel

    def unsubscribe(self, channel: queue.Queue[tuple[str, dict[str, Any]]]) -> None:
        # 该函数用于移除断开的 SSE 客户端订阅。
        with self._lock:
            if channel in self._subscribers:
                self._subscribers.remove(channel)

    def _publish(self, event: str, payload: dict[str, Any]) -> None:
        # 该函数用于把状态和日志推送给网页端。
        with self._lock:
            channels = list(self._subscribers)
        for channel in channels:
            channel.put((str(event), dict(payload)))

    get_snapshot = get_snapshot
    get_form_state = get_form_state
    _format_main_status = _format_main_status
    _main_indicator_state = _main_indicator_state
    _set_indicator = _set_indicator
    _set_main_status = _set_main_status
    _append_log = _append_log
    _refresh_temp_indicator = _refresh_temp_indicator
    _refresh_credential_indicators = _refresh_credential_indicators
    save_form = save_form
    save_buyer_urls = save_buyer_urls
    save_credentials = save_credentials
    _cancel_manual_login_watchers = _cancel_manual_login_watchers
    _get_login_target_spec = _get_login_target_spec
    _refresh_manual_login_overall_state = _refresh_manual_login_overall_state
    _refresh_ready_from_open_pages = _refresh_ready_from_open_pages
    _start_manual_login_watch = _start_manual_login_watch
    _watch_manual_login_target = _watch_manual_login_target
    open_login_target = open_login_target
    start_login_flow = start_login_flow
    _handle_login_message = _handle_login_message
    _login_worker = _login_worker
    _handle_controller_status = _handle_controller_status
    _ensure_relay_thread = _ensure_relay_thread
    _is_relay_thread_alive = _is_relay_thread_alive
    _run_controller = _run_controller
    start_or_resume = start_or_resume
    pause_resume = pause_resume
    stop_all = stop_all
    open_startup_log_file = open_startup_log_file
    exit_all = exit_all
    _exit_worker = _exit_worker
    _start_hotkey_watcher = _start_hotkey_watcher
    _run_runtime_maintenance_once = _run_runtime_maintenance_once
    _start_runtime_maintenance_watcher = _start_runtime_maintenance_watcher


__all__ = ["ControlCenterService"]
