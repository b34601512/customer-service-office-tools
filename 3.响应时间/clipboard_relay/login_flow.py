#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from collections.abc import Callable

from .browser_control import BrowserControl
from .config import AppConfig, CredentialConfig, TargetConfig
from .logger import log

_MODULE = "clipboard_relay.login_flow"
StatusFn = Callable[[str], None]
StopFn = Callable[[], bool]


def _emit(status: StatusFn | None, message: str) -> None:
    # 该函数用于把登录检测状态同时投递到后台和终端。
    log("Login", "状态", _MODULE, "_emit", message=message)
    if status is not None:
        status(message)


def wait_for_browser_page(
    *,
    browser: BrowserControl,
    target_key: str,
    target: TargetConfig,
    credentials: CredentialConfig,
    url: str,
    timeout_sec: float,
    poll_interval_sec: float,
    status: StatusFn | None = None,
    should_stop: StopFn | None = None,
):
    # 该函数用于等待受控浏览器进入目标业务页，避免依赖系统窗口状态。
    return browser.open_and_wait(
        target_key=target_key,
        target=target,
        credentials=credentials,
        url=url,
        timeout_sec=timeout_sec,
        poll_interval_sec=poll_interval_sec,
        status=status,
        should_stop=should_stop,
    )


def prepare_web_login_flow(
    *,
    config: AppConfig,
    browser: BrowserControl,
    status: StatusFn | None = None,
    should_stop: StopFn | None = None,
) -> None:
    # 该函数用于按顺序打开并等待咚咚客服网页和买家咨询网页登录完成。
    if not bool(config.login_flow.enabled):
        _emit(status, "网页登录引导已关闭，跳过。")
        return
    browser.update_login_flow(config.login_flow)
    _emit(status, "第一步：打开咚咚客服网页，请先登录客服端。")
    wait_for_browser_page(
        browser=browser,
        target_key="jd_service",
        target=config.jd_service,
        credentials=config.credentials.jd_service,
        url=config.service_url,
        timeout_sec=config.login_flow.login_wait_timeout_sec,
        poll_interval_sec=config.login_flow.login_poll_interval_sec,
        status=status,
        should_stop=should_stop,
    )
    _emit(status, "第二步：打开买家咨询网页，请登录买家端。")
    wait_for_browser_page(
        browser=browser,
        target_key="web_client",
        target=config.web_client,
        credentials=config.credentials.web_client,
        url=config.jd_url,
        timeout_sec=config.login_flow.login_wait_timeout_sec,
        poll_interval_sec=config.login_flow.login_poll_interval_sec,
        status=status,
        should_stop=should_stop,
    )
    _emit(status, "两个网页都已检测到，可以点击启动或按 F8 开始。")


__all__ = ["prepare_web_login_flow", "wait_for_browser_page"]
