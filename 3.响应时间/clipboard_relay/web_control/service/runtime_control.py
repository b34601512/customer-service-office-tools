#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import threading
import time
from dataclasses import replace
from pathlib import Path

from ...controller import RelayController
from ...hotkeys import HotkeyPoller
from ...temp_content import TempContentGenerator

def _handle_controller_status(self, payload: dict[str, object]) -> None:
    # 该函数用于接收控制器状态并转换成网页摘要。
    self._set_main_status(
        phase=str(payload.get("phase")) if payload.get("phase") is not None else None,
        remaining_sec=int(payload["remaining_sec"]) if payload.get("remaining_sec") is not None else None,
        completed_rounds=int(payload["completed_rounds"]) if payload.get("completed_rounds") is not None else None,
        total_rounds=int(payload["total_rounds"]) if payload.get("total_rounds") is not None else None,
    )

def _ensure_relay_thread(self, *, paused: bool) -> None:
    # 该函数用于确保主流程线程只启动一份。
    if self.relay_thread is not None and self.relay_thread.is_alive():
        return
    relay_config = replace(self.config, start_paused=paused)
    controller = RelayController(config=relay_config, desktop=self.browser, hotkeys=self.panel_hotkeys, content_generator=TempContentGenerator(relay_config.temporary_content), status_callback=self._handle_controller_status)
    self.relay_thread = threading.Thread(target=self._run_controller, args=(controller,), name="relay-controller", daemon=True)
    self.relay_thread.start()

def _is_relay_thread_alive(self) -> bool:
    # 该函数用于判断主流程是否真的在跑，避免暂停/停止按钮误伤登录流程。
    return self.relay_thread is not None and self.relay_thread.is_alive()

def _run_controller(self, controller: RelayController) -> None:
    # 该函数用于真正跑主流程，并在异常时把状态点标黄。
    try:
        controller.run()
        self._append_log("主流程已结束。")
    except Exception as exc:
        self._append_log(f"主流程异常：{exc}")
        self._set_main_status(phase="主流程异常，查看日志")
        self._set_indicator("browser", "warning", f"主流程异常：{exc}")

def start_or_resume(self) -> None:
    # 该函数用于启动或继续主流程。
    if not self.ready:
        self._refresh_ready_from_open_pages()
    if not self.ready:
        self._append_log("尚未就绪：请先点「准备网页登录」，完成后再启动。")
        return
    self._ensure_relay_thread(paused=True)
    self._set_main_status(phase="启动中", total_rounds=int(self.config.rounds))
    self.panel_hotkeys.request_pause_resume()
    self._append_log("已发送启动/继续信号。")

def pause_resume(self) -> None:
    # 该函数用于切换主流程暂停/继续。
    if not self._is_relay_thread_alive():
        self._append_log("主流程未启动，已忽略暂停/继续请求。")
        return
    self.panel_hotkeys.request_pause_resume()
    self._set_main_status(phase="切换中")
    self._append_log("已发送暂停/继续信号。")

def stop_all(self) -> None:
    # 该函数用于停止主流程。
    if not self._is_relay_thread_alive():
        self._append_log("主流程未启动，已忽略停止请求。")
        return
    self.stop_event.set()
    self.panel_hotkeys.request_stop()
    self._set_main_status(phase="停止中")
    self._append_log("已发送停止信号。")

def open_startup_log_file(self) -> str:
    # 该函数用于打开最近一次启动日志文件。
    logs_dir = self.config_path.parent / "logs"
    marker = logs_dir / "last_startup.log"
    candidate = Path(marker.read_text(encoding="utf-8").strip()) if marker.exists() and marker.read_text(encoding="utf-8").strip() else None
    if candidate is None or not candidate.exists():
        items = sorted(logs_dir.glob("startup_*.log"), key=lambda item: item.stat().st_mtime, reverse=True)
        if not items:
            raise RuntimeError(f"未找到启动日志文件：{logs_dir}")
        candidate = items[0]
    os.startfile(str(candidate))
    self._append_log(f"已打开启动日志文件：{candidate}")
    return str(candidate)

def exit_all(self) -> None:
    # 该函数用于触发后台退出，关闭受控浏览器并结束服务。
    if self.exiting:
        return
    self.exiting = True
    self.stop_event.set()
    self.panel_hotkeys.request_stop()
    self._set_main_status(phase="停止中")
    self._append_log("正在退出：停止流程并关闭本工具打开的网页。")
    threading.Thread(target=self._exit_worker, name="control-center-exit", daemon=True).start()

def _exit_worker(self) -> None:
    # 该函数用于直接强制清理本工具打开的浏览器，避免退出阶段卡在优雅关闭流程。
    try:
        self._append_log("退出流程改为直接强制清理，不再等待浏览器自行收尾。")
        self.browser.force_kill_managed_browsers()
        self._set_indicator("browser", "stopped", "受控浏览器已关闭。")
        self._append_log("已关闭本工具打开的网页。")
    finally:
        self.shutdown_event.set()

def _start_hotkey_watcher(self) -> None:
    # 该函数用于维持 F8/F9 全局热键能力。
    def _worker() -> None:
        poller = HotkeyPoller(pause_resume_key=self.config.hotkeys.pause_resume, stop_key=self.config.hotkeys.stop)
        while not self.shutdown_event.is_set():
            events = poller.poll()
            if events.pause_resume:
                self.start_or_resume()
            if events.stop:
                self.stop_all()
            time.sleep(0.1)

    threading.Thread(target=_worker, name="web-control-hotkeys", daemon=True).start()

__all__ = ["_handle_controller_status", "_ensure_relay_thread", "_is_relay_thread_alive", "_run_controller", "start_or_resume", "pause_resume", "stop_all", "open_startup_log_file", "exit_all", "_exit_worker", "_start_hotkey_watcher"]
