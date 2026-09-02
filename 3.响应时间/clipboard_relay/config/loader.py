#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .buyer_urls import load_current_jd_url, load_jd_url_entries, load_jd_url_note_from_mapping, url_entries_to_urls
from .credentials import load_credentials
from .models import AppConfig, BuyerUrlEntry, HotkeyConfig, LoginFlowConfig, TargetConfig
from .temp_content_loader import load_temp_content
from .validators import as_bool, as_float, as_int, as_keywords, as_ratio


def load_target(raw: dict[str, Any], *, field: str) -> TargetConfig:
    # 该函数用于把单个窗口目标配置收口为强类型对象，减少主流程里的防御代码。
    if not isinstance(raw, dict):
        raise RuntimeError(f"配置错误：{field} 必须是对象")
    random_min = as_float(raw.get("send_delay_random_min_sec", 3), field=f"{field}.send_delay_random_min_sec", min_value=0.0)
    random_max = as_float(raw.get("send_delay_random_max_sec", 5), field=f"{field}.send_delay_random_max_sec", min_value=0.0)
    if random_max < random_min:
        raise RuntimeError(f"配置错误：{field}.send_delay_random_max_sec 不能小于 send_delay_random_min_sec")
    return TargetConfig(
        name=str(raw.get("name") or field).strip(),
        title_keywords=as_keywords(raw.get("title_keywords"), field=f"{field}.title_keywords"),
        send_delay_sec=as_float(raw.get("send_delay_sec", 0), field=f"{field}.send_delay_sec", min_value=0.0),
        input_click_ratio=as_ratio(raw.get("input_click_ratio"), field=f"{field}.input_click_ratio"),
        press_enter=bool(raw.get("press_enter", True)),
        send_delay_random_min_sec=random_min,
        send_delay_random_max_sec=random_max,
    )


def load_login_flow(raw: Any) -> LoginFlowConfig:
    # 该函数用于读取网页登录引导配置：先咚咚客服网页，再买家咨询网页。
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise RuntimeError("配置错误：login_flow 必须是对象")
    return LoginFlowConfig(
        enabled=as_bool(raw.get("enabled", True), field="login_flow.enabled"),
        open_urls_in_new_window=as_bool(raw.get("open_urls_in_new_window", True), field="login_flow.open_urls_in_new_window"),
        login_wait_timeout_sec=as_float(raw.get("login_wait_timeout_sec", 600), field="login_flow.login_wait_timeout_sec", min_value=1.0),
        login_poll_interval_sec=as_float(raw.get("login_poll_interval_sec", 1.0), field="login_flow.login_poll_interval_sec", min_value=0.1),
        auto_start_on_panel_open=as_bool(raw.get("auto_start_on_panel_open", False), field="login_flow.auto_start_on_panel_open"),
        browser_executable=str(raw.get("browser_executable") or "").strip(),
    )


def load_config(path: str | Path) -> AppConfig:
    # 该函数用于读取并校验 config.json，让运行期拿到的配置已经可信。
    config_path = Path(path)
    if not config_path.exists():
        raise RuntimeError(f"配置文件不存在：{config_path}")
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise RuntimeError(f"读取配置失败：{config_path}（{type(exc).__name__}: {exc}）") from exc
    if not isinstance(raw, dict):
        raise RuntimeError("配置错误：根节点必须是对象")
    hotkeys = raw.get("hotkeys") or {}
    if not isinstance(hotkeys, dict):
        raise RuntimeError("配置错误：hotkeys 必须是对象")
    jd_url_entries = load_jd_url_entries(raw)
    jd_urls = url_entries_to_urls(jd_url_entries)
    jd_url = load_current_jd_url(raw, jd_urls)
    if jd_url and jd_url not in jd_urls:
        jd_url_entries = (BuyerUrlEntry(url=jd_url, note=load_jd_url_note_from_mapping(raw)), *jd_url_entries)
        jd_urls = url_entries_to_urls(jd_url_entries)
    return AppConfig(
        jd_url=jd_url,
        jd_urls=jd_urls,
        service_url=str(raw.get("service_url") or "https://dongdong.jd.com/").strip(),
        login_flow=load_login_flow(raw.get("login_flow")),
        open_url_on_start=bool(raw.get("open_url_on_start", True)),
        start_paused=bool(raw.get("start_paused", True)),
        rounds=as_int(raw.get("rounds", 1), field="rounds", min_value=1),
        work_duration_sec=as_float(raw.get("work_duration_sec", 60), field="work_duration_sec", min_value=0.0),
        rest_duration_sec=as_float(raw.get("rest_duration_sec", 60), field="rest_duration_sec", min_value=0.0),
        temporary_content=load_temp_content(raw.get("temporary_content")),
        web_client=load_target(raw.get("web_client"), field="web_client"),
        jd_service=load_target(raw.get("jd_service"), field="jd_service"),
        credentials=load_credentials(raw.get("credentials")),
        hotkeys=HotkeyConfig(
            pause_resume=str(hotkeys.get("pause_resume") or "F8").strip().upper(),
            stop=str(hotkeys.get("stop") or "F9").strip().upper(),
        ),
        jd_url_entries=jd_url_entries,
    )

