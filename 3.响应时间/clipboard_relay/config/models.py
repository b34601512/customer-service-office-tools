#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass

from ..temp_content import TempContentConfig


@dataclass(frozen=True)
class TargetConfig:
    name: str
    title_keywords: tuple[str, ...]
    send_delay_sec: float
    input_click_ratio: tuple[float, float]
    press_enter: bool
    send_delay_random_min_sec: float = 0.0
    send_delay_random_max_sec: float = 0.0


@dataclass(frozen=True)
class HotkeyConfig:
    pause_resume: str
    stop: str


@dataclass(frozen=True)
class LoginFlowConfig:
    enabled: bool
    open_urls_in_new_window: bool
    login_wait_timeout_sec: float
    login_poll_interval_sec: float
    auto_start_on_panel_open: bool
    browser_executable: str


@dataclass(frozen=True)
class CredentialConfig:
    username: str
    password: str


@dataclass(frozen=True)
class CredentialEntry:
    username: str
    password: str
    note: str = ""


@dataclass(frozen=True)
class CredentialsConfig:
    web_client: CredentialConfig
    jd_service: CredentialConfig
    web_client_entries: tuple[CredentialEntry, ...] = ()
    jd_service_entries: tuple[CredentialEntry, ...] = ()


@dataclass(frozen=True)
class BuyerUrlEntry:
    url: str
    note: str = ""


@dataclass(frozen=True)
class AppConfig:
    jd_url: str
    jd_urls: tuple[str, ...]
    service_url: str
    login_flow: LoginFlowConfig
    open_url_on_start: bool
    start_paused: bool
    rounds: int
    temporary_content: TempContentConfig
    web_client: TargetConfig
    jd_service: TargetConfig
    credentials: CredentialsConfig
    hotkeys: HotkeyConfig
    work_duration_sec: float = 60
    rest_duration_sec: float = 60
    jd_url_entries: tuple[BuyerUrlEntry, ...] = ()

