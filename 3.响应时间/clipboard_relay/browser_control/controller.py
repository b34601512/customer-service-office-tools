#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import queue
import threading
import time
from pathlib import Path
from typing import Any, Callable

from ..config import CredentialConfig, LoginFlowConfig, TargetConfig
from ..logger import log
from .context_cleanup import _close_contexts, _close_stale_profile_processes, _close_target
from .logging_utils import _MODULE, _STARTUP_STATE_POLL_SEC, _STARTUP_STATUS_LOG_INTERVAL_SEC, _log_browser
from .models import BrowserLoginProbe, BrowserPageState, _BrowserCommand
from .page_actions import _do_open_and_wait, _do_open_page, _do_probe_login_page, _do_send_text, _emit, _page_state
from .process_cleanup import kill_processes_matching_path
from .profile_paths import account_profile_key, user_data_dir
from .worker_loop import _worker_main


class BrowserControl:
    def __init__(self, *, profile_root: Path, login_flow: LoginFlowConfig) -> None:
        # 该控制器把所有 Playwright 操作收口到一个线程，避免跨线程页面句柄导致崩溃。
        self._profile_root = Path(profile_root)
        self._login_flow = login_flow
        self._commands: queue.Queue[_BrowserCommand | None] = queue.Queue()
        self._ready = threading.Event()
        self._closed = threading.Event()
        self._startup_error: BaseException | None = None
        self._thread: threading.Thread | None = None
        self._startup_lock = threading.RLock()

    def update_login_flow(self, login_flow: LoginFlowConfig) -> None:
        # 该函数用于刷新登录配置，让后台修改浏览器路径后下一次打开立即生效。
        self._login_flow = login_flow

    def start(self) -> None:
        # 该函数用于懒启动浏览器控制线程，让后台打开后不立即占用 Playwright。
        with self._startup_lock:
            if self._thread is None or not self._thread.is_alive():
                self._ready.clear()
                self._closed.clear()
                self._startup_error = None
                self._thread = threading.Thread(target=self._worker_main, name="browser-control", daemon=True)
                self._thread.start()
                _log_browser("启动控制线程", "start.thread_start", thread_name=self._thread.name)
        self._wait_until_worker_ready()
        if self._startup_error is not None:
            raise RuntimeError(f"浏览器控制线程启动失败：{self._startup_error}") from self._startup_error

    def open_page(self, *, target_key: str, target: TargetConfig, credentials: CredentialConfig, url: str) -> BrowserPageState:
        # 该函数用于在线程内打开单个受控页面。
        return self._call("open_page", target_key, target, credentials, url)

    def probe_login_page(
        self,
        *,
        target_key: str,
        target: TargetConfig,
        credentials: CredentialConfig,
        allow_click_login_entry: bool,
    ) -> BrowserLoginProbe:
        # 该函数用于快速探测已打开登录页的状态，让网页按钮能独立驱动登录检测。
        return self._call("probe_login_page", target_key, target, credentials, allow_click_login_entry)

    def open_and_wait(
        self,
        *,
        target_key: str,
        target: TargetConfig,
        credentials: CredentialConfig,
        url: str,
        timeout_sec: float,
        poll_interval_sec: float,
        status: Callable[[str], None] | None,
        should_stop: Callable[[], bool] | None,
    ) -> BrowserPageState:
        # 该函数用于打开页面并持续等到目标业务页，不把登录验证码误判为失败。
        return self._call("open_and_wait", target_key, target, credentials, url, timeout_sec, poll_interval_sec, status, should_stop)

    def send_text_to_target(self, target: TargetConfig, text: str) -> None:
        # 该函数用于把发送动作交给浏览器线程执行，避免页面对象跨线程使用。
        self._call("send_text", target, str(text or ""))

    def close_all(self) -> None:
        # 该函数用于关闭当前线程内全部受控页面。
        if self._thread is not None and self._thread.is_alive():
            self._call("close_all", timeout_sec=10.0)

    def stop(self) -> None:
        # 该函数用于停止浏览器控制线程，并等待线程收尾。
        if self._thread is None:
            return
        if self._thread.is_alive():
            self._commands.put(None)
            self._closed.wait(timeout=10)
        self._thread = None

    def force_kill_managed_browsers(self) -> None:
        # 该函数用于强制清理本工具资料目录下的浏览器进程，确保退出时不残留窗口。
        killed = self._kill_processes_matching_path(self._profile_root)
        if killed:
            log("Browser", "强制清理受控浏览器", _MODULE, "force_kill_managed_browsers", profile_root=str(self._profile_root), pids=",".join(killed))
        self._thread = None

    def _call(self, name: str, *args: Any, timeout_sec: float | None = None, **kwargs: Any) -> Any:
        # 该函数用于把外部请求封装成线程命令，并把原始异常抛回调用方。
        self.start()
        command = _BrowserCommand(name=name, args=tuple(args), kwargs=dict(kwargs), done=threading.Event())
        self._commands.put(command)
        completed = command.done.wait(timeout=None if timeout_sec is None else max(0.1, float(timeout_sec)))
        if not completed:
            raise RuntimeError(f"浏览器控制命令超时：{name}")
        if command.error is not None:
            raise command.error
        return command.result

    def _wait_until_worker_ready(self) -> None:
        # 该函数按线程真实状态等待就绪，避免电脑慢时被固定 15 秒误判为失败。
        started_at = time.monotonic()
        last_log_at = started_at
        while True:
            if self._ready.wait(timeout=_STARTUP_STATE_POLL_SEC):
                return
            thread = self._thread
            if thread is None:
                raise RuntimeError("浏览器控制线程启动失败：线程未创建")
            if not thread.is_alive():
                if self._startup_error is not None:
                    return
                raise RuntimeError("浏览器控制线程启动失败：线程未进入就绪状态就已退出")
            now = time.monotonic()
            if now - last_log_at >= _STARTUP_STATUS_LOG_INTERVAL_SEC:
                last_log_at = now
                _log_browser("等待控制线程就绪", "start.wait_ready", elapsed_sec=round(now - started_at, 1))

    _worker_main = _worker_main
    _do_open_page = _do_open_page
    _do_probe_login_page = _do_probe_login_page
    _do_open_and_wait = _do_open_and_wait
    _do_send_text = _do_send_text
    _page_state = _page_state
    _close_target = _close_target
    _close_stale_profile_processes = _close_stale_profile_processes
    _close_contexts = _close_contexts
    _emit = _emit
    _kill_processes_matching_path = staticmethod(kill_processes_matching_path)

    @staticmethod
    def _account_profile_key(credentials: CredentialConfig) -> str:
        # 该函数保留旧测试入口，真实规则放在 profile_paths 模块。
        return account_profile_key(credentials)

    def _user_data_dir(self, *, executable: str, target_key: str, credentials: CredentialConfig) -> Path:
        # 该函数保留旧类方法入口，真实目录规则放在 profile_paths 模块。
        return user_data_dir(profile_root=self._profile_root, executable=executable, target_key=target_key, credentials=credentials)


__all__ = ["BrowserControl"]
