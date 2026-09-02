#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import time
from typing import Any

from ...app_metadata import APP_METADATA
from ...logger import log
from .constants import _MODULE
from .form_codec import _format_buyer_url_entries, _format_credential_entries, _format_number, _format_numbers

def get_snapshot(self) -> dict[str, Any]:
    # 该函数用于输出当前网页后台完整快照。
    with self._lock:
        runtime = {
            "statusText": self._format_main_status(),
            "statusPhase": self.status_phase,
            "statusRemainingSec": self.status_remaining_sec,
            "completedRounds": self.completed_rounds,
            "totalRounds": self.total_rounds,
            "ready": self.ready,
            "loginRunning": self.login_running,
            "indicators": {key: dict(value) for key, value in self.indicators.items()},
            "logLines": list(self.log_lines[-300:]),
        }
    return {
        "appMetadata": {
            "appName": APP_METADATA.app_name,
            "version": APP_METADATA.version,
            "usageHistory": dict(self.usage_history),
        },
        "form": self.get_form_state(),
        "runtime": runtime,
    }

def get_form_state(self) -> dict[str, Any]:
    # 该函数用于把当前配置转换成网页表单可直接展示的字符串。
    config = self.config
    return {
        "service_url": config.service_url,
        "jd_url": config.jd_url,
        "jd_urls": "\n".join(config.jd_urls),
        "jd_url_options": list(config.jd_urls),
        "jd_url_entries": _format_buyer_url_entries(config.jd_url_entries, config.jd_urls),
        "service_keywords": ",".join(config.jd_service.title_keywords),
        "web_keywords": ",".join(config.web_client.title_keywords),
        "service_ratio": _format_numbers(list(config.jd_service.input_click_ratio)),
        "web_ratio": _format_numbers(list(config.web_client.input_click_ratio)),
        "service_delay": _format_number(config.jd_service.send_delay_sec),
        "service_random_delay": _format_numbers([config.jd_service.send_delay_random_min_sec, config.jd_service.send_delay_random_max_sec]),
        "web_delay": _format_number(config.web_client.send_delay_sec),
        "web_random_delay": _format_numbers([config.web_client.send_delay_random_min_sec, config.web_client.send_delay_random_max_sec]),
        "rounds": str(config.rounds),
        "login_timeout": _format_number(config.login_flow.login_wait_timeout_sec),
        "service_username": config.credentials.jd_service.username,
        "service_password": config.credentials.jd_service.password,
        "service_credential_entries": _format_credential_entries(config.credentials.jd_service_entries, config.credentials.jd_service),
        "web_username": config.credentials.web_client.username,
        "web_password": config.credentials.web_client.password,
        "web_credential_entries": _format_credential_entries(config.credentials.web_client_entries, config.credentials.web_client),
        "work_rest": _format_numbers([config.work_duration_sec, config.rest_duration_sec]),
        "emoji_probability": _format_number(config.temporary_content.emoji_append_probability),
        "emoji_count_range": f"{config.temporary_content.emoji_min_count},{config.temporary_content.emoji_max_count}",
        "browser_executable": config.login_flow.browser_executable,
    }

def _format_main_status(self) -> str:
    # 该函数用于生成网页顶部固定状态栏文案。
    phase = str(self.status_phase or "待命")
    if self.status_remaining_sec is not None and phase in {"工作中", "休息中"}:
        phase = f"{phase}（剩余 {self.status_remaining_sec} 秒）"
    return f"{phase}｜总工作任务 {self.completed_rounds}/{self.total_rounds}"

def _main_indicator_state(self, phase: str) -> str:
    # 该函数用于把主流程状态映射成状态点颜色。
    if "异常" in phase or "失败" in phase:
        return "warning"
    if phase in {"工作中", "休息中", "启动中", "登录中", "切换中", "停止中"}:
        return "running"
    if phase in {"已完成", "就绪"}:
        return "ok"
    return "idle"

def _set_indicator(self, key: str, state: str, detail: str) -> None:
    # 该函数用于统一更新状态点。
    if key not in self.indicators:
        return
    with self._lock:
        self.indicators[key]["state"] = str(state)
        self.indicators[key]["detail"] = str(detail)
    self._publish("state", {"runtime": self.get_snapshot()["runtime"]})

def _set_main_status(self, *, phase: str | None = None, remaining_sec: int | None = None, completed_rounds: int | None = None, total_rounds: int | None = None) -> None:
    # 该函数用于统一更新主状态栏。
    with self._lock:
        if phase is not None:
            self.status_phase = str(phase)
        if remaining_sec is not None:
            self.status_remaining_sec = int(remaining_sec)
        elif phase is not None:
            self.status_remaining_sec = None
        if completed_rounds is not None:
            self.completed_rounds = int(completed_rounds)
        if total_rounds is not None:
            self.total_rounds = max(1, int(total_rounds))
    self._set_indicator("main", self._main_indicator_state(self.status_phase), self._format_main_status())

def _append_log(self, message: str) -> None:
    # 该函数用于记录并推送日志。
    text = str(message or "")
    line = f"{time.strftime('%H:%M:%S')} {text}"
    with self._lock:
        self.log_lines.append(line)
        self.log_lines = self.log_lines[-2000:]
    log("Panel", "状态", _MODULE, "_append_log", message=text)
    self._publish("log", {"line": line})

def _refresh_temp_indicator(self) -> None:
    # 该函数用于刷新内容引擎状态点，明确当前版本固定走直连发送。
    self._set_indicator("temp", "ok", "已启用：当前版本固定使用内置内容引擎直接写入页面，不再监听系统剪切板。")

def _refresh_credential_indicators(self, *, preserve_active: bool = False) -> None:
    # 该函数用于根据是否已配置账号密码刷新登录提示，但不能误把已登录状态刷回灰色。
    service_text = "已配置咚咚客服端账号密码；到登录页后会自动填入。" if self.config.credentials.jd_service.username and self.config.credentials.jd_service.password else "未配置咚咚客服端账号密码；到登录页后需要人工输入。"
    web_text = "已配置买家客户端账号密码；到登录页后会自动填入。" if self.config.credentials.web_client.username and self.config.credentials.web_client.password else "未配置买家客户端账号密码；到登录页后需要人工输入。"
    if not (preserve_active and self.indicators["service"]["state"] in {"running", "ok"}):
        self._set_indicator("service", "idle", service_text)
    if not (preserve_active and self.indicators["web"]["state"] in {"running", "ok"}):
        self._set_indicator("web", "idle", web_text)

__all__ = ["get_snapshot", "get_form_state", "_format_main_status", "_main_indicator_state", "_set_indicator", "_set_main_status", "_append_log", "_refresh_temp_indicator", "_refresh_credential_indicators"]
