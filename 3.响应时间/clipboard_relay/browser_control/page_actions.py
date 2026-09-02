#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

from ..browser_dom import click_send_button_or_enter, ensure_first_consulting_customer_selected, find_reply_input, overwrite_reply_input
from ..browser_resolver import resolve_browser_executable
from ..config import CredentialConfig, TargetConfig
from ..login_dom import LoginFillResult, try_fill_login_form
from ..logger import log
from .logging_utils import _MODULE
from .models import BrowserLoginProbe, BrowserPageState
from .title_matcher import _display_title_text, _title_matches

def _do_open_page(
    self,
    playwright: Any,
    contexts: dict[str, Any],
    pages: dict[str, Any],
    target_keys_by_name: dict[str, str],
    target_key: str,
    target: TargetConfig,
    credentials: CredentialConfig,
    url: str,
    *,
    wait: bool,
) -> BrowserPageState:
    # 该函数用于打开我们自己控制的独立浏览器页面，不复用用户正在操作的浏览器。
    key = str(target_key or "").strip()
    target_url = str(url or "").strip()
    if not key:
        raise RuntimeError("打开受控浏览器失败：target_key 不能为空")
    if not target_url:
        raise RuntimeError(f"打开受控浏览器失败：{target.name} URL 不能为空")
    self._close_target(contexts, pages, target_keys_by_name, key)
    executable = resolve_browser_executable(self._login_flow)
    user_data_dir = self._user_data_dir(executable=executable, target_key=key, credentials=credentials)
    user_data_dir.mkdir(parents=True, exist_ok=True)
    self._close_stale_profile_processes(user_data_dir)
    account_profile = self._account_profile_key(credentials)
    log("Browser", "启动受控浏览器", _MODULE, "_do_open_page.launch", target_key=key, account_profile=account_profile, executable=executable, profile=str(user_data_dir), url=target_url)
    context = playwright.chromium.launch_persistent_context(
        user_data_dir=str(user_data_dir),
        executable_path=executable,
        headless=False,
        viewport={"width": 1400, "height": 900},
        locale="zh-CN",
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-default-browser-check",
            "--disable-popup-blocking",
        ],
    )
    context.set_default_timeout(10000)
    page = context.pages[0] if context.pages else context.new_page()
    page.goto(target_url, wait_until="domcontentloaded", timeout=60000)
    contexts[key] = context
    pages[key] = page
    target_keys_by_name[str(target.name)] = key
    state = self._page_state(key, target, page, user_data_dir)
    log("Browser", "受控浏览器页面已打开", _MODULE, "_do_open_page.opened", target=target.name, title=state.title, url=state.url)
    return state

def _do_probe_login_page(
    self,
    pages: dict[str, Any],
    target_key: str,
    target: TargetConfig,
    credentials: CredentialConfig,
    allow_click_login_entry: bool,
) -> BrowserLoginProbe:
    # 该函数用于读取受控登录页当前状态，并尝试一次账号密码自动填充。
    key = str(target_key or "").strip()
    if not key:
        raise RuntimeError("探测登录页失败：target_key 不能为空")
    page = pages.get(key)
    if page is None:
        raise RuntimeError(f"探测登录页失败：{target.name} 尚未由本工具打开")
    if page.is_closed():
        raise RuntimeError(f"探测登录页失败：{target.name} 的受控页面已关闭")
    title = str(page.title() or "")
    current_url = str(page.url or "")
    title_matched = _title_matches(title, target.title_keywords)
    if title_matched:
        fill_result = LoginFillResult()
    else:
        try:
            fill_result = try_fill_login_form(page, credentials, target_name=target.name, allow_click_login_entry=allow_click_login_entry)
        except Exception as exc:
            log("Browser", "登录页探测继续等待", _MODULE, "_do_probe_login_page.wait", target=target.name, reason=str(exc))
            fill_result = LoginFillResult(detail=f"{target.name} 登录页暂时不可自动检测，请手动完成登录；后台会继续等待目标页面。")
    executable = resolve_browser_executable(self._login_flow)
    user_data_dir = self._user_data_dir(executable=executable, target_key=key, credentials=credentials)
    page_state = BrowserPageState(target_key=key, target_name=target.name, title=title, url=current_url, user_data_dir=user_data_dir)
    return BrowserLoginProbe(page_state=page_state, title_matched=title_matched, fill_result=fill_result)

def _do_open_and_wait(
    self,
    playwright: Any,
    contexts: dict[str, Any],
    pages: dict[str, Any],
    target_keys_by_name: dict[str, str],
    target_key: str,
    target: TargetConfig,
    credentials: CredentialConfig,
    url: str,
    timeout_sec: float,
    poll_interval_sec: float,
    status: Callable[[str], None] | None,
    should_stop: Callable[[], bool] | None,
) -> BrowserPageState:
    # 该函数用于持续等待目标业务页出现；用户忙于验证码时只更新状态，不按固定超时失败。
    state = self._do_open_page(playwright, contexts, pages, target_keys_by_name, target_key, target, credentials, url, wait=False)
    last_log = 0.0
    last_detail = ""
    clicked_login_entry = False
    autofill_done = False
    page = pages[str(target_key)]
    user_data_dir = state.user_data_dir
    while True:
        if should_stop is not None and should_stop():
            raise RuntimeError(f"等待登录中止：{target.name}")
        title = str(page.title() or "")
        current_url = str(page.url or "")
        if _title_matches(title, target.title_keywords):
            result = BrowserPageState(str(target_key), target.name, title, current_url, user_data_dir)
            self._emit(status, f"已检测到：{target.name}｜{_display_title_text(title)}")
            return result
        if not autofill_done:
            try:
                fill_result = try_fill_login_form(page, credentials, target_name=target.name, allow_click_login_entry=not clicked_login_entry)
            except Exception as exc:
                log("Browser", "登录自动填充继续等待", _MODULE, "_do_open_and_wait.fill_wait", target=target.name, reason=str(exc))
                fill_result = LoginFillResult(detail=f"{target.name} 登录页暂时不可自动检测，请手动完成登录；后台会继续等待目标页面。")
            clicked_login_entry = clicked_login_entry or bool(fill_result.clicked_login_entry)
            if fill_result.filled:
                autofill_done = True
                self._emit(status, fill_result.detail)
            elif fill_result.detail and fill_result.detail != last_detail:
                last_detail = fill_result.detail
                self._emit(status, fill_result.detail)
        now = time.monotonic()
        if now - last_log >= 5.0:
            last_log = now
            self._emit(status, f"等待登录：{target.name}，当前标题「{_display_title_text(title)}」。")
        time.sleep(max(0.1, float(poll_interval_sec)))

def _do_send_text(
    self,
    pages: dict[str, Any],
    target_keys_by_name: dict[str, str],
    target: TargetConfig,
    text: str,
) -> None:
    # 该函数用于在后台直接控制受控浏览器页面写入并发送文本。
    content = str(text or "")
    if not content.strip():
        raise RuntimeError(f"发送失败：{target.name} 的待发送文本为空")
    key = target_keys_by_name.get(str(target.name))
    if not key or key not in pages:
        raise RuntimeError(f"发送失败：{target.name} 尚未由本工具打开受控浏览器页面")
    page = pages[key]
    if page.is_closed():
        raise RuntimeError(f"发送失败：{target.name} 的受控页面已关闭")
    if key == "jd_service":
        ensure_first_consulting_customer_selected(page)
    locator = find_reply_input(page, target)
    write_mode = overwrite_reply_input(page, locator, content)
    if bool(target.press_enter):
        sent_by = click_send_button_or_enter(page)
    else:
        sent_by = "仅写入"
    log("Browser", "目标发送完成", _MODULE, "_do_send_text", target=target.name, length=len(content), write_mode=write_mode, sent_by=sent_by)
    return None

def _page_state(self, target_key: str, target: TargetConfig, page: Any, user_data_dir: Path) -> BrowserPageState:
    return BrowserPageState(target_key=target_key, target_name=target.name, title=str(page.title() or ""), url=str(page.url or ""), user_data_dir=user_data_dir)


def _emit(self, status: Callable[[str], None] | None, message: str) -> None:
    log("Browser", "状态", _MODULE, "_emit", message=message)
    if status is not None:
        status(message)


__all__ = ["_do_open_page", "_do_probe_login_page", "_do_open_and_wait", "_do_send_text", "_page_state", "_emit"]
