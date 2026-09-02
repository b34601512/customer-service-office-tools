#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import queue
import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .app_metadata import APP_METADATA
from .browser_control import BrowserControl
from .config import AppConfig, config_from_payload, config_to_dict, get_active_account, get_active_room, load_config, save_config
from .logger import get_log_file, log

_MODULE = "douyin_commenter.service"


@dataclass(frozen=True)
class RuntimeStatus:
    phase: str
    last_comment: str
    last_error: str


class CommenterService:
    def __init__(self, *, config_path: Path) -> None:
        # 该服务用于把网页后台、配置、浏览器控制和单次评论发送统一收口。
        self.config_path = Path(config_path)
        self.config = load_config(self.config_path)
        self.browser = BrowserControl(profile_root=self.config_path.parent / "runtime" / "browser_profiles")
        self.shutdown_event = threading.Event()
        self.exiting = False
        self._lock = threading.RLock()
        self._send_lock = threading.Lock()
        self._subscribers: list[queue.Queue[tuple[str, dict[str, Any]]]] = []
        self._log_lines: list[str] = []
        self._status = RuntimeStatus(phase="待命", last_comment="", last_error="")
        self._completed_task_count = 0
        self._active_page: dict[str, str] = {}
        self._append_log("后台已待命。先打开直播间并登录抖音，再发送评论。")

    def get_config(self) -> AppConfig:
        # 该函数用于读取最新配置，避免保存后按钮动作仍使用旧配置。
        with self._lock:
            return self.config

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

    def _publish(self, event_name: str, payload: dict[str, Any]) -> None:
        # 该函数用于把状态和日志推送给网页端。
        with self._lock:
            subscribers = list(self._subscribers)
        for channel in subscribers:
            channel.put((str(event_name), dict(payload)))

    def _append_log(self, message: str) -> None:
        # 该函数用于记录用户可读运行日志，并同步推送到网页。
        text = str(message or "").strip()
        line = f"{time.strftime('%H:%M:%S')} {text}"
        with self._lock:
            self._log_lines.append(line)
            self._log_lines = self._log_lines[-1000:]
        log("Panel", "状态", _MODULE, "_append_log", message=text)
        self._publish("log", {"line": line})
        self._publish_state()

    def _update_runtime_status(self, status: RuntimeStatus) -> None:
        # 该函数用于刷新网页端运行状态。
        with self._lock:
            self._status = status
        self._publish_state()

    def _publish_state(self) -> None:
        # 该函数用于推送当前完整运行快照。
        self._publish("state", {"runtime": self.get_snapshot()["runtime"]})

    def get_snapshot(self) -> dict[str, Any]:
        # 该函数用于输出网页后台完整快照。
        with self._lock:
            config = self.config
            active_room = get_active_room(config)
            active_account = get_active_account(config)
            status = self._status
            runtime = {
                "statusText": self._format_status_text(status),
                "phase": status.phase,
                "lastComment": status.last_comment,
                "lastError": status.last_error,
                "completedTaskCount": self._completed_task_count,
                "totalTaskCount": self._get_total_task_count(config),
                "taskProgressText": self._format_task_progress_text(config),
                "taskLimitReached": self._is_task_limit_reached(config),
                "activeRoomName": active_room.name,
                "activeAccountName": active_account.name,
                "activePage": dict(self._active_page),
                "logLines": list(self._log_lines[-300:]),
            }
            form = config_to_dict(config)
        return {
            "appMetadata": {"appName": APP_METADATA.app_name, "version": APP_METADATA.version},
            "form": form,
            "runtime": runtime,
        }

    def _format_status_text(self, status: RuntimeStatus) -> str:
        # 该函数用于生成顶部状态文案，保证用户任何操作都有反馈。
        if status.last_error:
            return f"{status.phase}｜{status.last_error}"
        return status.phase

    def _get_total_task_count(self, config: AppConfig | None = None) -> int:
        # 该函数用于读取总工作任务目标，所有展示和拦截都以配置为唯一来源。
        target_config = config or self.config
        return max(1, int(target_config.work_task.total_count))

    def _format_task_progress_text(self, config: AppConfig | None = None) -> str:
        # 该函数用于统一生成总工作任务展示文案，避免前后端各自拼接导致不一致。
        return f"总工作任务 {self._completed_task_count}/{self._get_total_task_count(config)}"

    def _is_task_limit_reached(self, config: AppConfig | None = None) -> bool:
        # 该函数用于判断本次运行是否已达到总任务上限。
        return self._completed_task_count >= self._get_total_task_count(config)

    def _assert_task_quota_available(self, *, text: str) -> None:
        # 该函数用于在真正发送前拦截超额任务，防止自动倒计时继续误发。
        with self._lock:
            if not self._is_task_limit_reached():
                return
            message = f"{self._format_task_progress_text()} 已完成，请在运行配置里调大总任务数后再继续。"
            self._status = RuntimeStatus(phase="已完成", last_comment=self._status.last_comment, last_error="")
        self._publish_state()
        raise RuntimeError(message)

    def _mark_task_completed(self) -> tuple[int, int]:
        # 该函数用于在页面确认发送成功后累计本次运行任务数。
        with self._lock:
            self._completed_task_count += 1
            return self._completed_task_count, self._get_total_task_count()

    def save_form(self, payload: dict[str, Any]) -> dict[str, Any]:
        # 该函数用于保存完整配置，并立即广播给网页端。
        next_config = config_from_payload(payload)
        with self._lock:
            self.config = next_config
            if self._is_task_limit_reached(next_config):
                self._status = RuntimeStatus(phase="已完成", last_comment=self._status.last_comment, last_error="")
            elif self._status.phase == "已完成":
                self._status = RuntimeStatus(phase="待命", last_comment=self._status.last_comment, last_error="")
            save_config(self.config_path, self.config)
        self._append_log("配置已保存。")
        self._publish_state()
        return config_to_dict(next_config)

    def open_room(self) -> dict[str, str]:
        # 该函数用于打开当前直播间，登录态由当前账号档案的浏览器资料目录保存。
        config = self.get_config()
        room = get_active_room(config)
        account = get_active_account(config)
        state = self.browser.open_room(room=room, account=account, browser=config.browser)
        with self._lock:
            self._active_page = {"room": state.room_name, "account": state.account_name, "title": state.title, "url": state.url}
        self._append_log(f"直播间已打开：{state.room_name}｜账号档案：{state.account_name}")
        return dict(self._active_page)

    def send_now(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        # 该函数用于把前端输入框里的明确内容发送到当前已打开直播间，不再重开浏览器。
        with self._send_lock:
            request_payload = payload or {}
            text = str(request_payload.get("text") or "").strip()
            comment_id = str(request_payload.get("comment_id") or "").strip()
            if not text:
                raise RuntimeError("立即发送失败：评论内容为空，请先输入或选择评论库自动填入。")
            self._assert_task_quota_available(text=text)
            self._update_runtime_status(RuntimeStatus(phase="立即发送中", last_comment=text, last_error=""))
            try:
                self.browser.send_comment(text)
            except Exception as exc:
                self._update_runtime_status(RuntimeStatus(phase="异常", last_comment=text, last_error=str(exc)))
                raise
            completed_count, total_count = self._mark_task_completed()
            sent_count_updated = self._mark_comment_sent(comment_id=comment_id, text=text)
            next_phase = "已完成" if completed_count >= total_count else "待命"
            self._update_runtime_status(RuntimeStatus(phase=next_phase, last_comment=text, last_error=""))
            self._append_log(f"已立即发送评论：{text}（总工作任务 {completed_count}/{total_count}）")
            return {
                "text": text,
                "comment_id": comment_id,
                "sent_count_updated": sent_count_updated,
                "form": config_to_dict(self.get_config()),
                "runtime": self.get_snapshot()["runtime"],
            }

    def _mark_comment_sent(self, *, comment_id: str, text: str) -> bool:
        # 该函数用于在评论发送成功后累计次数，失败或文本不匹配时不改配置。
        if not comment_id:
            return False
        sent_text = str(text or "").strip()
        with self._lock:
            target = next((comment for comment in self.config.comments if comment.id == comment_id), None)
            if target is None:
                log("Panel", "评论计数跳过", _MODULE, "_mark_comment_sent.missing", comment_id=comment_id)
                return False
            if target.text.strip() != sent_text:
                log("Panel", "评论计数跳过", _MODULE, "_mark_comment_sent.text_changed", comment_id=comment_id)
                return False
            next_comments = tuple(
                replace(comment, sent_count=comment.sent_count + 1) if comment.id == comment_id else comment
                for comment in self.config.comments
            )
            self.config = replace(self.config, comments=next_comments)
            save_config(self.config_path, self.config)
            next_count = target.sent_count + 1
        log("Panel", "评论计数已更新", _MODULE, "_mark_comment_sent", comment_id=comment_id, sent_count=next_count)
        self._publish_state()
        return True

    def open_log_file(self) -> str:
        # 该函数用于打开本次运行唯一日志文件。
        log_file = get_log_file()
        if log_file is None or not log_file.exists():
            raise RuntimeError("当前运行日志不存在。")
        os.startfile(str(log_file))
        self._append_log(f"已打开日志文件：{log_file}")
        return str(log_file)

    def exit_all(self) -> None:
        # 该函数用于触发后台退出，关闭本工具打开的浏览器和后台线程。
        if self.exiting:
            return
        self.exiting = True
        self._append_log("正在退出：关闭本工具打开的浏览器和后台线程。")
        threading.Thread(target=self._exit_worker, name="douyin-commenter-exit", daemon=True).start()

    def _exit_worker(self) -> None:
        # 该函数用于后台清理浏览器，避免 HTTP 请求阻塞。
        try:
            self.browser.stop()
            self.browser.force_kill_profiles()
            self._append_log("已关闭本工具打开的浏览器。")
        finally:
            self.shutdown_event.set()


__all__ = ["CommenterService"]
