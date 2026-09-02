#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import replace
from typing import Any

from ...config import CredentialConfig, CredentialsConfig, app_config_to_dict, save_config
from .form_codec import _parse_buyer_url_entries, _parse_credential_entries, _parse_pair, _parse_range, _parse_ratio, _split_keywords

def save_form(self, payload: dict[str, Any]) -> dict[str, Any]:
    # 该函数用于从网页表单保存配置，并同步刷新状态点。
    current = self.config
    service_random_min, service_random_max = _parse_range(str(payload.get("service_random_delay", "")), field="咚咚随机延迟秒")
    web_random_min, web_random_max = _parse_range(str(payload.get("web_random_delay", "")), field="买家随机延迟秒")
    emoji_min, emoji_max = _parse_range(str(payload.get("emoji_count_range", "")), field="表情数量范围")
    work_duration, rest_duration = _parse_pair(str(payload.get("work_rest", "")), field="工作/休息秒")
    emoji_probability = float(str(payload.get("emoji_probability", "")))
    rounds = int(str(payload.get("rounds", "")))
    if rounds < 1:
        raise RuntimeError("总轮数不能小于 1")
    if not (0 <= emoji_probability <= 1):
        raise RuntimeError("表情概率必须在 0 到 1 之间")
    selected_jd_url = str(payload.get("jd_url", "")).strip()
    jd_url_entries = _parse_buyer_url_entries(payload.get("jd_url_entries"), str(payload.get("jd_urls", "")), selected_url=selected_jd_url)
    jd_urls = tuple(entry.url for entry in jd_url_entries if entry.url)
    if not selected_jd_url:
        selected_jd_url = jd_urls[0] if jd_urls else ""
    selected_service_credential = CredentialConfig(str(payload.get("service_username", "")).strip(), str(payload.get("service_password", "")))
    selected_web_credential = CredentialConfig(str(payload.get("web_username", "")).strip(), str(payload.get("web_password", "")))
    service_credential_entries = _parse_credential_entries(
        payload.get("service_credential_entries"),
        selected=selected_service_credential,
        fallback_entries=current.credentials.jd_service_entries,
        field="咚咚",
    )
    web_credential_entries = _parse_credential_entries(
        payload.get("web_credential_entries"),
        selected=selected_web_credential,
        fallback_entries=current.credentials.web_client_entries,
        field="买家",
    )
    self.config = replace(
        current,
        service_url=str(payload.get("service_url", "")).strip(),
        jd_url=selected_jd_url,
        jd_urls=jd_urls,
        jd_url_entries=jd_url_entries,
        login_flow=replace(
            current.login_flow,
            login_wait_timeout_sec=float(str(payload.get("login_timeout", ""))),
            browser_executable=str(payload.get("browser_executable", "")).strip(),
        ),
        credentials=CredentialsConfig(
            jd_service=selected_service_credential,
            web_client=selected_web_credential,
            jd_service_entries=service_credential_entries,
            web_client_entries=web_credential_entries,
        ),
        rounds=rounds,
        work_duration_sec=work_duration,
        rest_duration_sec=rest_duration,
        temporary_content=replace(current.temporary_content, emoji_append_probability=emoji_probability, emoji_min_count=int(emoji_min), emoji_max_count=int(emoji_max)),
        web_client=replace(current.web_client, title_keywords=_split_keywords(str(payload.get("web_keywords", ""))), send_delay_sec=float(str(payload.get("web_delay", ""))), input_click_ratio=_parse_ratio(str(payload.get("web_ratio", ""))), send_delay_random_min_sec=web_random_min, send_delay_random_max_sec=web_random_max),
        jd_service=replace(current.jd_service, title_keywords=_split_keywords(str(payload.get("service_keywords", ""))), send_delay_sec=float(str(payload.get("service_delay", ""))), input_click_ratio=_parse_ratio(str(payload.get("service_ratio", ""))), send_delay_random_min_sec=service_random_min, send_delay_random_max_sec=service_random_max),
    )
    save_config(self.config_path, self.config)
    self.browser.update_login_flow(self.config.login_flow)
    self.total_rounds = int(self.config.rounds)
    self._refresh_temp_indicator()
    self._refresh_credential_indicators(preserve_active=True)
    self._set_main_status(total_rounds=int(self.config.rounds))
    self._append_log("配置已保存。")
    snapshot = self.get_snapshot()
    self._publish("state", {"runtime": snapshot["runtime"], "form": snapshot["form"]})
    return app_config_to_dict(self.config)

def save_buyer_urls(self, payload: dict[str, Any]) -> dict[str, Any]:
    # 该函数用于只保存买家咨询店铺信息，避免被其它运行配置字段校验阻断。
    selected_jd_url = str(payload.get("jd_url", "")).strip()
    jd_url_entries = _parse_buyer_url_entries(payload.get("jd_url_entries"), str(payload.get("jd_urls", "")), selected_url=selected_jd_url)
    jd_urls = tuple(entry.url for entry in jd_url_entries if entry.url)
    if not selected_jd_url:
        selected_jd_url = jd_urls[0] if jd_urls else ""
    self.config = replace(
        self.config,
        jd_url=selected_jd_url,
        jd_urls=jd_urls,
        jd_url_entries=jd_url_entries,
    )
    save_config(self.config_path, self.config)
    self._append_log("买家咨询店铺信息已保存。")
    snapshot = self.get_snapshot()
    self._publish("state", {"runtime": snapshot["runtime"], "form": snapshot["form"]})
    return app_config_to_dict(self.config)

def save_credentials(self, payload: dict[str, Any]) -> dict[str, Any]:
    # 该函数用于只保存网页登录账号档案，避免被其它运行配置字段校验阻断。
    selected_service_credential = CredentialConfig(str(payload.get("service_username", "")).strip(), str(payload.get("service_password", "")))
    selected_web_credential = CredentialConfig(str(payload.get("web_username", "")).strip(), str(payload.get("web_password", "")))
    service_credential_entries = _parse_credential_entries(
        payload.get("service_credential_entries"),
        selected=selected_service_credential,
        fallback_entries=self.config.credentials.jd_service_entries,
        field="咚咚",
    )
    web_credential_entries = _parse_credential_entries(
        payload.get("web_credential_entries"),
        selected=selected_web_credential,
        fallback_entries=self.config.credentials.web_client_entries,
        field="买家",
    )
    self.config = replace(
        self.config,
        credentials=CredentialsConfig(
            jd_service=selected_service_credential,
            web_client=selected_web_credential,
            jd_service_entries=service_credential_entries,
            web_client_entries=web_credential_entries,
        ),
    )
    save_config(self.config_path, self.config)
    self._refresh_credential_indicators(preserve_active=True)
    self._append_log("网页登录账号信息已保存。")
    snapshot = self.get_snapshot()
    self._publish("state", {"runtime": snapshot["runtime"], "form": snapshot["form"]})
    return app_config_to_dict(self.config)

__all__ = ["save_form", "save_buyer_urls", "save_credentials"]
