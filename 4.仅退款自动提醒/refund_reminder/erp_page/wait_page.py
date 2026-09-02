# 该文件用于等待 ERP 进入订单查询页。
from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

from ..config import AppConfig
from ..erp_navigation import try_enter_order_query_page
from .types import BrowserPageState


class WaitOrderPageMixin:
    def _do_wait_order_page(self, page: Any, user_data_dir: Path | None, config: AppConfig, status: Callable[[str], None] | None) -> BrowserPageState:
        # 该函数用于等待 ERP 进入订单查询页，核心是轮询页面状态而不是固定睡眠。
        self._require_page(page, user_data_dir)
        login_deadline: float | None = None
        order_page_deadline: float | None = None
        poll = max(0.2, float(config.login.poll_interval_sec))
        last_action = 0.0
        last_diagnosis_key = ""
        last_wait_status_key = ""
        last_enter_order_page_result: bool | None = None
        last_login_wait_page = False
        while True:
            diagnosis = self._diagnose_order_page(page, config)
            if diagnosis.ready:
                state = self._page_state(page, user_data_dir)
                self._emit(status, f"已检测到订单查询页：命中 {diagnosis.matched_count} 个特征「{'、'.join(diagnosis.matched_landmarks) or '无'}」｜{state.title or state.url}")
                return state
            now = time.monotonic()
            page_title = self._safe_page_title(page) or "空"
            if diagnosis.login_wait_page:
                if login_deadline is None:
                    login_deadline = now + max(0.01, float(config.login.login_wait_timeout_sec))
                if now >= login_deadline:
                    raise RuntimeError(f"等待登录超时：已等待 {config.login.login_wait_timeout_sec:g} 秒，请确认已在受控浏览器完成登录。最后标题={page_title!r} URL={self._safe_page_url(page)!r}")
            else:
                if order_page_deadline is None or last_login_wait_page:
                    order_page_deadline = now + max(0.01, float(config.login.order_page_wait_timeout_sec))
                if now >= order_page_deadline:
                    raise RuntimeError(f"等待订单查询页超时：请确认已登录并能看到订单查询页。最后标题={page_title!r} URL={self._safe_page_url(page)!r}")
            last_login_wait_page = diagnosis.login_wait_page
            wait_status_key = f"{'login' if diagnosis.login_wait_page else 'waiting'}|{page_title}|{diagnosis.matched_count}|{diagnosis.has_order_keyword}|{diagnosis.required_texts_matched}"
            if diagnosis.login_wait_page:
                if wait_status_key != last_wait_status_key:
                    self._emit(status, f"检测到登录等待页，请先在受控浏览器里完成登录；登录完成后会继续自动等待订单查询页。当前标题「{page_title}」。")
                    last_wait_status_key = wait_status_key
            elif now - last_action >= 2.0:
                last_action = now
                entered = try_enter_order_query_page(page)
                if entered and last_enter_order_page_result is not True:
                    self._emit(status, "已尝试从首页菜单进入订单查询页，等待页面加载完成。")
                    last_wait_status_key = wait_status_key
                last_enter_order_page_result = entered
            if not diagnosis.login_wait_page and wait_status_key != last_wait_status_key:
                self._emit(status, f"等待订单查询页，当前标题「{page_title}」。")
                last_wait_status_key = wait_status_key
            diagnosis_key = self._diagnosis_key(diagnosis)
            if diagnosis_key != last_diagnosis_key:
                last_diagnosis_key = diagnosis_key
                self._emit(status, self._format_order_page_diagnosis(diagnosis))
            time.sleep(poll)


__all__ = ["WaitOrderPageMixin"]
