#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .config import CredentialConfig
from .logger import log

_MODULE = "clipboard_relay.login_dom"

_ACCOUNT_LOGIN_SELECTORS = (
    'button:has-text("密码登录")',
    'a:has-text("密码登录")',
    'button:has-text("账号登录")',
    'a:has-text("账号登录")',
    'a:has-text("账户登录")',
    'button:has-text("账户登录")',
    "text=密码登录",
    "text=账号登录",
    "text=账户登录",
)
_LOGIN_ENTRY_SELECTORS = (
    ".el-message-box__btns .el-button--primary",
    ".el-message-box__btns button",
    "a.hd-login",
    'button:has-text("现在登录")',
    'a:has-text("现在登录")',
    'button:has-text("现在去登录")',
    'a:has-text("现在去登录")',
    'button:has-text("去登录")',
    'a:has-text("去登录")',
    'button:has-text("立即登录")',
    'a:has-text("立即登录")',
    "a.login-btn",
    "button.login-btn",
    'a[href*="login"]',
    'a:has-text("登录")',
    'button:has-text("登录")',
    "text=登录",
)
_USERNAME_SELECTORS = (
    "#loginname",
    'input[name="loginname"]',
    'input[placeholder*="账号"]',
    'input[placeholder*="用户名"]',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
)
_PASSWORD_SELECTORS = (
    "#nloginpwd",
    'input[name="nloginpwd"]',
    'input[placeholder*="密码"]',
    'input[type="password"]',
)


def _summarize_ui_block_reason(exc: BaseException) -> str:
    # 该函数用于把 Playwright 的英文长栈压缩成用户能处理的中文状态。
    text = str(exc or "")
    lowered = text.lower()
    if "captcha" in lowered or "验证码" in text or "intercepts pointer events" in lowered or "modalmask" in lowered:
        return "页面验证码或弹层正在遮挡自动操作"
    if "timeout" in lowered:
        return "页面元素暂时没有进入可操作状态"
    return f"页面暂时拒绝自动操作：{type(exc).__name__}"


def _try_click(locator: Any, *, target_name: str, action_name: str) -> str:
    # 该函数用于尝试点击登录控件，失败时返回可继续等待的状态而不是中断检测线程。
    try:
        locator.click(timeout=3000)
        return ""
    except Exception as exc:
        reason = _summarize_ui_block_reason(exc)
        log("LoginDom", "登录点击等待人工处理", _MODULE, "_try_click.blocked", target=target_name, click_action=action_name, reason=reason)
        return f"{target_name} {reason}，请手动完成验证码/登录；后台会继续检测目标页面。"


@dataclass(frozen=True)
class LoginFillResult:
    clicked_login_entry: bool = False
    filled: bool = False
    detail: str = ""


def _first_visible(container: Any, selectors: tuple[str, ...]) -> Any | None:
    # 该函数用于按优先级寻找第一个可见元素，避免选择器散落在登录流程里。
    for selector in selectors:
        try:
            locator = container.locator(selector).first
            if int(locator.count()) > 0 and bool(locator.is_visible(timeout=300)):
                return locator
        except Exception:
            continue
    return None


def _container_has_form(container: Any) -> bool:
    # 该函数用于快速判断页面或 iframe 里有没有登录表单特征。
    if _first_visible(container, _USERNAME_SELECTORS) is not None:
        return True
    if _first_visible(container, _PASSWORD_SELECTORS) is not None:
        return True
    if _first_visible(container, _ACCOUNT_LOGIN_SELECTORS) is not None:
        return True
    return False


def _find_login_container(page: Any) -> Any | None:
    # 该函数用于兼容登录表单出现在主页面或 iframe 的两种情况。
    if _container_has_form(page):
        return page
    for frame in page.frames:
        if frame == page.main_frame:
            continue
        if _container_has_form(frame):
            return frame
    return None


def _switch_to_account_login(container: Any, *, target_name: str) -> str:
    # 该函数用于优先切到账号密码登录，确保后续能够自动填入凭据。
    account_login = _first_visible(container, _ACCOUNT_LOGIN_SELECTORS)
    if account_login is None:
        return ""
    class_name = ""
    try:
        class_name = str(account_login.get_attribute("class", timeout=300) or "")
    except Exception:
        class_name = ""
    if "checked" in class_name:
        return ""
    return _try_click(account_login, target_name=target_name, action_name="切换账号密码登录")


def _wait_login_inputs(page: Any) -> None:
    # 该函数用于等待登录输入框动态出现，避免表单切换后立刻取控件导致漏判。
    page.wait_for_function(
        """() => {
            const candidates = Array.from(document.querySelectorAll('input'));
            return candidates.some((element) => {
                const style = window.getComputedStyle(element);
                const visible = style && style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
                if (!visible) return false;
                const text = [
                    element.getAttribute('placeholder'),
                    element.getAttribute('aria-label'),
                    element.getAttribute('name'),
                    element.getAttribute('type')
                ].filter(Boolean).join(' ');
                return /账号|邮箱|密码|登录|手机号|user|login/i.test(text);
            });
        }""",
        timeout=3000,
        polling="mutation",
    )


def try_fill_login_form(page: Any, credentials: CredentialConfig, *, target_name: str, allow_click_login_entry: bool) -> LoginFillResult:
    # 该函数用于在登录页自动填入账号密码，但保留滑块/验证码给人工处理。
    username = str(credentials.username or "").strip()
    password = str(credentials.password or "")
    if not username or not password:
        return LoginFillResult(detail=f"{target_name} 未配置账号密码，将等待人工输入。")

    clicked_login_entry = False
    container = _find_login_container(page)
    if container is None and allow_click_login_entry:
        login_entry = _first_visible(page, _LOGIN_ENTRY_SELECTORS)
        if login_entry is not None:
            blocked_detail = _try_click(login_entry, target_name=target_name, action_name="点击登录入口")
            if blocked_detail:
                return LoginFillResult(clicked_login_entry=False, detail=blocked_detail)
            page.wait_for_timeout(200)
            clicked_login_entry = True
            container = _find_login_container(page)
            log("LoginDom", "点击登录入口", _MODULE, "try_fill_login_form.login_entry", target=target_name)

    if container is None:
        return LoginFillResult(clicked_login_entry=clicked_login_entry, detail=f"{target_name} 当前还没有出现可自动填充的登录表单。")

    blocked_detail = _switch_to_account_login(container, target_name=target_name)
    if blocked_detail:
        return LoginFillResult(clicked_login_entry=clicked_login_entry, detail=blocked_detail)
    try:
        _wait_login_inputs(page)
    except Exception:
        pass
    page.wait_for_timeout(120)

    username_input = _first_visible(container, _USERNAME_SELECTORS)
    password_input = _first_visible(container, _PASSWORD_SELECTORS)
    if username_input is None or password_input is None:
        return LoginFillResult(clicked_login_entry=clicked_login_entry, detail=f"{target_name} 登录表单已出现，但账号或密码输入框还未准备好。")

    try:
        username_input.fill(username, timeout=3000)
        password_input.fill(password, timeout=3000)
    except Exception as exc:
        reason = _summarize_ui_block_reason(exc)
        log("LoginDom", "登录填充等待人工处理", _MODULE, "try_fill_login_form.fill_blocked", target=target_name, reason=reason)
        return LoginFillResult(clicked_login_entry=clicked_login_entry, detail=f"{target_name} {reason}，请手动完成登录；后台会继续检测目标页面。")
    log("LoginDom", "自动填入账号密码", _MODULE, "try_fill_login_form.filled", target=target_name, username=username)
    return LoginFillResult(
        clicked_login_entry=clicked_login_entry,
        filled=True,
        detail=f"{target_name} 账号密码已自动填入，请完成滑块/验证码后手动点击登录。",
    )


__all__ = ["LoginFillResult", "try_fill_login_form"]
