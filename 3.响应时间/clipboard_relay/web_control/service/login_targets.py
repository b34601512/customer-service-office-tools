#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import threading
import time

from ...browser_control import _display_title_text
from ...login_flow import prepare_web_login_flow
from .models import _LoginTargetSpec


def _ready_indicator_detail(title: str) -> str:
    # 该函数用于生成首页成功状态，只告诉用户结果，不展示机器链接。
    return f"{title}已正常进入目标页面。"


def _detected_log_message(spec: _LoginTargetSpec, page_state: object) -> str:
    # 该函数用于生成检测成功日志，保留短标题但不把长跳转链接写进首页日志。
    page_title = _display_title_text(getattr(page_state, "title", ""))
    return f"已检测到：{spec.target.name}｜{page_title}"


def _waiting_login_message(spec: _LoginTargetSpec, page_state: object) -> str:
    # 该函数用于生成等待登录文案，遇到跳转长链接时只显示“页面加载中”。
    page_title = _display_title_text(getattr(page_state, "title", ""))
    return f"等待登录：{spec.target.name}，当前标题「{page_title}」。"


def _clean_login_status_message(message: str) -> str:
    # 该函数用于兜住浏览器状态消息，防止长跳转链接进入网页日志。
    text = str(message or "")
    if "｜" in text and ("已检测到：" in text or "等待登录：" in text):
        left, right = text.split("｜", 1)
        return f"{left}｜{_display_title_text(right)}"
    if "当前标题「" in text and "」。" in text:
        prefix, rest = text.split("当前标题「", 1)
        raw_title, suffix = rest.split("」。", 1)
        return f"{prefix}当前标题「{_display_title_text(raw_title)}」。{suffix}"
    return text


def _cancel_manual_login_watchers(self) -> None:
    # 该函数用于让旧的单页登录检测线程立刻失效，避免和新动作互相覆盖状态。
    with self._lock:
        for key in self._manual_login_tokens:
            self._manual_login_tokens[key] += 1

def _get_login_target_spec(self, indicator_key: str) -> _LoginTargetSpec:
    # 该函数用于把网页按钮 key 转成统一的登录目标描述，减少分支散落。
    key = str(indicator_key or "").strip()
    if key == "service":
        return _LoginTargetSpec(
            indicator_key="service",
            browser_target_key="jd_service",
            title="咚咚客服端",
            target=self.config.jd_service,
            credentials=self.config.credentials.jd_service,
            url=self.config.service_url,
        )
    if key == "web":
        if not self.config.jd_url:
            raise RuntimeError("买家咨询网址为空，请先给选中的店铺填写网址并保存配置。")
        return _LoginTargetSpec(
            indicator_key="web",
            browser_target_key="web_client",
            title="买家客户端",
            target=self.config.web_client,
            credentials=self.config.credentials.web_client,
            url=self.config.jd_url,
        )
    raise RuntimeError(f"未知登录按钮：{indicator_key}")

def _refresh_manual_login_overall_state(self) -> None:
    # 该函数用于把两个单页登录按钮的结果汇总成整体就绪状态。
    if self.login_running:
        return
    service_state = self.indicators["service"]["state"]
    web_state = self.indicators["web"]["state"]
    if service_state == "ok" and web_state == "ok":
        was_ready = self.ready
        self.ready = True
        self._set_indicator("browser", "ok", "两个受控浏览器页面都已就绪；只控制本工具打开的独立浏览器。")
        self._set_main_status(phase="就绪", completed_rounds=0, total_rounds=int(self.config.rounds))
        if not was_ready:
            self._append_log("两个网页都已就绪；尚未启动发送，请点「启动」或按 F8。")
        return
    self.ready = False
    if "warning" in {service_state, web_state}:
        self._set_indicator("browser", "warning", "有网页登录未就绪，请重新点击对应按钮打开并完成登录。")
        self._set_main_status(phase="登录异常", completed_rounds=0, total_rounds=int(self.config.rounds))
        return
    self._set_indicator("browser", "running", "受控浏览器已打开，请分别完成两个网页登录。")
    self._set_main_status(phase="登录中", completed_rounds=0, total_rounds=int(self.config.rounds))

def _refresh_ready_from_open_pages(self) -> None:
    # 该函数用于启动前复检受控浏览器真实状态，避免旧的 ready 标记卡住。
    if self.login_running:
        return
    for indicator_key in ("service", "web"):
        try:
            spec = self._get_login_target_spec(indicator_key)
        except Exception as exc:
            self._set_indicator(indicator_key, "warning", f"启动前复检未通过：{exc}")
            self._refresh_manual_login_overall_state()
            return
        try:
            probe = self.browser.probe_login_page(
                target_key=spec.browser_target_key,
                target=spec.target,
                credentials=spec.credentials,
                allow_click_login_entry=False,
            )
        except Exception as exc:
            message = f"{spec.title} 启动前复检未通过：{exc}"
            self._set_indicator(spec.indicator_key, "warning", message)
            self._refresh_manual_login_overall_state()
            return
        detail = str(probe.fill_result.detail or "").strip()
        if probe.title_matched:
            if self.indicators[spec.indicator_key]["state"] != "ok":
                self._append_log(_detected_log_message(spec, probe.page_state))
            self._set_indicator(spec.indicator_key, "ok", _ready_indicator_detail(spec.title))
            continue
        self._set_indicator(spec.indicator_key, "running", detail or _waiting_login_message(spec, probe.page_state))
        self._refresh_manual_login_overall_state()
        return
    self._refresh_manual_login_overall_state()

def _start_manual_login_watch(self, spec: _LoginTargetSpec, token: int) -> None:
    # 该函数用于为单个网页登录按钮启动后台检测线程。
    thread = threading.Thread(target=self._watch_manual_login_target, args=(spec, token), name=f"manual-login-{spec.indicator_key}", daemon=True)
    self._manual_login_threads[spec.indicator_key] = thread
    thread.start()

def _watch_manual_login_target(self, spec: _LoginTargetSpec, token: int) -> None:
    # 该函数用于持续轮询单个受控网页登录状态，直到变绿、用户停止或页面失效。
    poll_interval = max(0.2, float(self.config.login_flow.login_poll_interval_sec))
    last_wait_log_at = 0.0
    last_detail = ""
    clicked_login_entry = False
    while not self.shutdown_event.is_set():
        if self.shutdown_event.is_set() or self.stop_event.is_set() or self.login_running:
            return
        if self._manual_login_tokens.get(spec.indicator_key) != token:
            return
        try:
            probe = self.browser.probe_login_page(
                target_key=spec.browser_target_key,
                target=spec.target,
                credentials=spec.credentials,
                allow_click_login_entry=not clicked_login_entry,
            )
        except Exception as exc:
            message = f"{spec.title} 登录页检测失败：{exc}"
            self._set_indicator(spec.indicator_key, "warning", message)
            self._append_log(message)
            self._refresh_manual_login_overall_state()
            return
        clicked_login_entry = clicked_login_entry or bool(probe.fill_result.clicked_login_entry)
        detail = str(probe.fill_result.detail or "").strip()
        wait_message = _waiting_login_message(spec, probe.page_state)
        if detail and detail != last_detail:
            last_detail = detail
            self._append_log(detail)
        if probe.title_matched:
            self._append_log(_detected_log_message(spec, probe.page_state))
            self._set_indicator(spec.indicator_key, "ok", _ready_indicator_detail(spec.title))
            self._refresh_manual_login_overall_state()
            return
        self._set_indicator(spec.indicator_key, "running", detail or wait_message)
        now = time.monotonic()
        if now - last_wait_log_at >= 5.0:
            last_wait_log_at = now
            self._append_log(wait_message)
        time.sleep(poll_interval)

def open_login_target(self, indicator_key: str) -> str:
    # 该函数用于响应网页状态按钮点击，单独打开对应登录页并开始检测。
    if self.login_running:
        raise RuntimeError("网页登录准备流程正在运行，请先等当前流程结束。")
    if self.status_phase in {"工作中", "休息中", "启动中", "切换中", "停止中"}:
        raise RuntimeError("主流程运行中，不能重新打开登录页。")
    spec = self._get_login_target_spec(indicator_key)
    token = int(self._manual_login_tokens.get(spec.indicator_key, 0)) + 1
    self._manual_login_tokens[spec.indicator_key] = token
    self.stop_event.clear()
    self.ready = False
    self._set_main_status(phase="登录中", completed_rounds=0, total_rounds=int(self.config.rounds))
    self._set_indicator("browser", "running", "正在启动本工具专用浏览器，并等待两个网页登录完成。")
    self._set_indicator(spec.indicator_key, "running", f"正在打开{spec.title}登录页，请在受控浏览器里完成登录。")
    state = self.browser.open_page(target_key=spec.browser_target_key, target=spec.target, credentials=spec.credentials, url=spec.url)
    self._append_log(f"已打开{spec.title}登录页：{state.url or spec.url}")
    self._refresh_manual_login_overall_state()
    self._start_manual_login_watch(spec, token)
    return spec.title

def start_login_flow(self) -> None:
    # 该函数用于开始网页登录准备流程。
    if self.login_running:
        self._append_log("网页登录检测已经在运行。")
        return
    self._cancel_manual_login_watchers()
    self.stop_event.clear()
    self.ready = False
    self.login_running = True
    self.completed_rounds = 0
    self._set_main_status(phase="登录中", completed_rounds=0, total_rounds=int(self.config.rounds))
    self._set_indicator("browser", "running", "准备启动本工具专用浏览器并检测两个网页登录状态。")
    self._set_indicator("service", "running", "即将打开咚咚客服端；如已配置账号密码，到登录页后会自动填入。")
    self._set_indicator("web", "idle", "等待咚咚客服端就绪后，再打开买家客户端。")
    self.login_thread = threading.Thread(target=self._login_worker, name="login-flow", daemon=True)
    self.login_thread.start()

def _handle_login_message(self, message: str) -> None:
    # 该函数用于把登录阶段日志翻译成状态点。
    text = _clean_login_status_message(str(message or ""))
    self._append_log(text)
    service_name = self.config.jd_service.name
    web_name = self.config.web_client.name
    if "第一步" in text:
        self._set_indicator("browser", "running", "正在启动本工具专用浏览器，并打开咚咚客服端。")
        self._set_indicator("service", "running", "正在打开咚咚客服端，请在受控浏览器里完成登录。")
    elif "第二步" in text:
        self._set_indicator("web", "running", "正在打开买家咨询页，请在受控浏览器里完成登录。")
    elif "账号密码已自动填入" in text:
        self._set_indicator("service" if service_name in text else "web", "running", text)
    elif f"等待登录：{service_name}" in text:
        self._set_indicator("service", "running", text)
    elif f"等待登录：{web_name}" in text:
        self._set_indicator("web", "running", text)
    elif f"已检测到：{service_name}" in text:
        self._set_indicator("service", "ok", _ready_indicator_detail("咚咚客服端"))
    elif f"已检测到：{web_name}" in text:
        self._set_indicator("web", "ok", _ready_indicator_detail("买家客户端"))
    elif "两个网页都已检测到" in text:
        self._set_indicator("browser", "ok", "两个受控浏览器页面都已就绪；只控制本工具打开的独立浏览器。")

def _login_worker(self) -> None:
    # 该函数用于在后台线程执行网页登录流程。
    try:
        prepare_web_login_flow(config=self.config, browser=self.browser, status=self._handle_login_message, should_stop=self.stop_event.is_set)
        self.ready = True
        self._set_main_status(phase="就绪", completed_rounds=0, total_rounds=int(self.config.rounds))
        self._append_log("两个网页都已就绪；尚未启动发送，请点「启动」或按 F8。")
    except Exception as exc:
        self._append_log(f"网页登录流程失败：{exc}")
        self._set_main_status(phase="登录异常")
        self._set_indicator("browser", "warning", f"网页登录流程失败：{exc}")
    finally:
        self.login_running = False

__all__ = ["_cancel_manual_login_watchers", "_get_login_target_spec", "_refresh_manual_login_overall_state", "_refresh_ready_from_open_pages", "_start_manual_login_watch", "_watch_manual_login_target", "open_login_target", "start_login_flow", "_handle_login_message", "_login_worker"]
