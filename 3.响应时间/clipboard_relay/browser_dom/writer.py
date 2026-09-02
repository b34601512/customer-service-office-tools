#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import time
from typing import Any

from ..logger import log
from .metadata import _read_reply_input_meta
from .preparation import _prepare_reply_input_for_write
from .reader import _read_reply_input_value_from_page, read_input_value
from .scripts import (
    _MODULE,
    _REPLY_INPUT_PAGE_SET_TEXT_SCRIPT,
    _REPLY_INPUT_POLL_INTERVAL_SEC,
    _REPLY_INPUT_PROGRESS_LOG_SEC,
    _REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS,
    _REPLY_INPUT_SELECTOR,
    _REPLY_INPUT_SET_TEXT_SCRIPT,
    _REPLY_INPUT_STABLE_MISMATCH_POLLS,
    _REPLY_INPUT_EMPTY_MISMATCH_POLLS,
    _REPLY_INPUT_WRITE_CONFIRM_TIMEOUT_SEC,
    _REPLY_INPUT_WRITE_POLL_INTERVAL_SEC,
)
from .state import _combine_errors
from .text_utils import _preview_text, normalize_editor_text

def _wait_for_reply_input_value(page: Any, locator: Any, expected: str) -> tuple[bool, str, BaseException | None]:
    # 该函数用于轮询等待输入框回读稳定，并在页面重绘导致 locator 失效时动态重读 DOM。
    normalized_expected = normalize_editor_text(expected)
    deadline = time.monotonic() + _REPLY_INPUT_WRITE_CONFIRM_TIMEOUT_SEC
    last_value = ""
    last_error: BaseException | None = None
    stable_value = ""
    stable_mismatch_polls = 0
    empty_mismatch_polls = 0
    last_progress_log = 0.0
    while True:
        locator_error: BaseException | None = None
        page_error: BaseException | None = None
        if hasattr(page, "evaluate"):
            try:
                page_value = _read_reply_input_value_from_page(page)
                if page_value:
                    last_value = page_value
                if normalize_editor_text(page_value) == normalized_expected:
                    return True, page_value, None
            except BaseException as exc:
                page_error = exc
        if not hasattr(page, "evaluate") or page_error is not None:
            try:
                locator_value = _call_public_read_input_value(locator)
                if locator_value:
                    last_value = locator_value
                if normalize_editor_text(locator_value) == normalized_expected:
                    if page_error is not None:
                        log(
                            "Browser",
                            "locator回读接管",
                            _MODULE,
                            "_wait_for_reply_input_value",
                            reason=f"{type(page_error).__name__}: {page_error}",
                            actual_length=len(normalize_editor_text(locator_value)),
                        )
                    return True, locator_value, None
            except BaseException as exc:
                locator_error = exc
        last_error = _combine_errors(("locator回读", locator_error), ("页面回读", page_error))
        current_value = normalize_editor_text(last_value)
        if current_value and current_value == stable_value:
            stable_mismatch_polls += 1
        elif current_value:
            stable_value = current_value
            stable_mismatch_polls = 1
            empty_mismatch_polls = 0
        else:
            stable_value = ""
            stable_mismatch_polls = 0
            empty_mismatch_polls += 1
        if stable_mismatch_polls >= _REPLY_INPUT_STABLE_MISMATCH_POLLS:
            return False, last_value, last_error
        if empty_mismatch_polls >= _REPLY_INPUT_EMPTY_MISMATCH_POLLS:
            return False, last_value, last_error
        now = time.monotonic()
        if now - last_progress_log >= _REPLY_INPUT_PROGRESS_LOG_SEC:
            last_progress_log = now
            log(
                "Browser",
                "等待输入框回读匹配",
                _MODULE,
                "_wait_for_reply_input_value",
                expected_length=len(normalized_expected),
                actual_length=len(current_value),
                stable_polls=stable_mismatch_polls,
                empty_polls=empty_mismatch_polls,
                reason="" if last_error is None else f"{type(last_error).__name__}: {last_error}",
            )
        if time.monotonic() >= deadline:
            return False, last_value, last_error
        time.sleep(_REPLY_INPUT_WRITE_POLL_INTERVAL_SEC)


def _set_reply_input_via_dom(locator: Any, text: str) -> dict[str, Any]:
    # 该函数用于直接通过 DOM 设置输入框内容，并主动派发输入事件。
    result = locator.evaluate(_REPLY_INPUT_SET_TEXT_SCRIPT, str(text or ""), timeout=_REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS)
    if not isinstance(result, dict):
        raise RuntimeError(f"DOM 写入输入框失败：页面返回了非对象状态，当前值={result!r}")
    return result


def _set_reply_input_via_page_dom(page: Any, text: str) -> dict[str, Any]:
    # 该函数用于页面重绘后重新选择最佳输入框写入，避免旧 locator 卡死。
    result = page.evaluate(_REPLY_INPUT_PAGE_SET_TEXT_SCRIPT, {"selector": _REPLY_INPUT_SELECTOR, "value": str(text or "")})
    if not isinstance(result, dict):
        raise RuntimeError(f"页面级 DOM 写入输入框失败：页面返回了非对象状态，当前值={result!r}")
    if not bool(result.get("ok")):
        raise RuntimeError(
            "页面级 DOM 写入输入框失败："
            f"{result.get('reason') or '未知原因'}；"
            f"候选={int(result.get('count') or 0)}，"
            f"可见={int(result.get('visible_count') or 0)}，"
            f"可编辑={int(result.get('editable_count') or 0)}"
        )
    return result


def _log_write_attempt(mode: str, *, expected: str, actual: str, success: bool, meta: dict[str, Any], error: BaseException | None = None) -> None:
    # 该函数用于统一记录每次写入尝试的结果，便于从日志直接看出失败停在哪一步。
    log(
        "Browser",
        "输入框写入尝试",
        _MODULE,
        f"overwrite_reply_input.{mode}",
        success=bool(success),
        expected_length=len(normalize_editor_text(expected)),
        actual_length=len(normalize_editor_text(actual)),
        tag=str(meta.get("tag") or ""),
        type=str(meta.get("type") or ""),
        role=str(meta.get("role") or ""),
        maxlength=int(meta.get("maxlength") or -1),
        placeholder=_preview_text(str(meta.get("placeholder") or ""), limit=24),
        actual_preview=_preview_text(actual),
        reason="" if error is None else f"{type(error).__name__}: {error}",
    )



def _call_public_read_input_value(locator: Any) -> str:
    # 该函数用于兼容旧测试补丁路径，同时让真实读取逻辑留在 reader 模块。
    public_module = sys.modules.get("clipboard_relay.browser_dom")
    public_reader = getattr(public_module, "read_input_value", read_input_value) if public_module is not None else read_input_value
    return str(public_reader(locator))


def _call_public_wait_for_reply_input_value(page: Any, locator: Any, expected: str) -> tuple[bool, str, BaseException | None]:
    # 该函数用于兼容旧测试补丁路径，同时避免把写入流程重新塞回入口文件。
    public_module = sys.modules.get("clipboard_relay.browser_dom")
    public_waiter = getattr(public_module, "_wait_for_reply_input_value", _wait_for_reply_input_value) if public_module is not None else _wait_for_reply_input_value
    if public_waiter is not _wait_for_reply_input_value:
        return public_waiter(page, locator, expected)
    return _wait_for_reply_input_value(page, locator, expected)

def overwrite_reply_input(page: Any, locator: Any, text: str) -> str:
    # 该函数用于按多级直连策略写入回复内容，不再回退到系统剪切板。
    normalized = normalize_editor_text(text)
    meta = _read_reply_input_meta(page, locator)
    log(
        "Browser",
        "输入框写入开始",
        _MODULE,
        "overwrite_reply_input.start",
        expected_length=len(normalized),
        tag=str(meta.get("tag") or ""),
        type=str(meta.get("type") or ""),
        role=str(meta.get("role") or ""),
        maxlength=int(meta.get("maxlength") or -1),
        placeholder=_preview_text(str(meta.get("placeholder") or ""), limit=24),
    )
    page_dom_error: BaseException | None = None
    page_dom_read_error: BaseException | None = None
    fill_prepare_error: BaseException | None = None
    fill_error: BaseException | None = None
    fill_read_error: BaseException | None = None
    keyboard_prepare_error: BaseException | None = None
    keyboard_error: BaseException | None = None
    keyboard_read_error: BaseException | None = None
    dom_error: BaseException | None = None
    dom_read_error: BaseException | None = None
    last_value = ""

    if hasattr(page, "evaluate"):
        try:
            _set_reply_input_via_page_dom(page, normalized)
        except BaseException as exc:
            page_dom_error = exc
        success, last_value, page_dom_read_error = _call_public_wait_for_reply_input_value(page, locator, normalized)
        _log_write_attempt(
            "page_dom",
            expected=normalized,
            actual=last_value,
            success=success,
            meta=meta,
            error=_combine_errors(("页面级DOM", page_dom_error), ("回读", page_dom_read_error)),
        )
        if success:
            return "page_dom"

    fill_prepare_error = _prepare_reply_input_for_write(locator, action="fill写入前聚焦")
    try:
        locator.fill(normalized, timeout=5000)
    except BaseException as exc:
        fill_error = exc
    success, last_value, fill_read_error = _call_public_wait_for_reply_input_value(page, locator, normalized)
    _log_write_attempt(
        "fill",
        expected=normalized,
        actual=last_value,
        success=success,
        meta=meta,
        error=_combine_errors(("fill", fill_error), ("回读", fill_read_error)),
    )
    if success:
        return "fill"

    try:
        keyboard_prepare_error = _prepare_reply_input_for_write(locator, action="keyboard写入前聚焦")
        page.keyboard.press("Control+A")
        page.keyboard.insert_text(normalized)
    except BaseException as exc:
        keyboard_error = exc
    success, last_value, keyboard_read_error = _call_public_wait_for_reply_input_value(page, locator, normalized)
    _log_write_attempt(
        "keyboard",
        expected=normalized,
        actual=last_value,
        success=success,
        meta=meta,
        error=_combine_errors(("keyboard", keyboard_error), ("回读", keyboard_read_error)),
    )
    if success:
        return "keyboard_fallback" if fill_error else "keyboard"

    try:
        try:
            _set_reply_input_via_page_dom(page, normalized)
        except BaseException as page_dom_fallback_error:
            _set_reply_input_via_dom(locator, normalized)
            dom_error = page_dom_fallback_error
    except BaseException as exc:
        dom_error = _combine_errors(("页面级DOM", dom_error), ("locatorDOM", exc))
    success, last_value, dom_read_error = _call_public_wait_for_reply_input_value(page, locator, normalized)
    _log_write_attempt(
        "dom",
        expected=normalized,
        actual=last_value,
        success=success,
        meta=meta,
        error=_combine_errors(("dom", dom_error), ("回读", dom_read_error)),
    )
    if success:
        return "dom_fallback"

    actual_normalized = normalize_editor_text(last_value)
    extra: list[str] = []
    maxlength = int(meta.get("maxlength") or -1)
    if maxlength > 0:
        extra.append(f"控件maxlength={maxlength}")
    if actual_normalized and normalized.startswith(actual_normalized) and len(actual_normalized) < len(normalized):
        extra.append(f"疑似页面截断：期望长度={len(normalized)}，实际长度={len(actual_normalized)}")
    if page_dom_error is not None:
        extra.append(f"页面级DOM报错={type(page_dom_error).__name__}: {page_dom_error}")
    if page_dom_read_error is not None:
        extra.append(f"页面级DOM回读报错={type(page_dom_read_error).__name__}: {page_dom_read_error}")
    if fill_prepare_error is not None:
        extra.append(f"fill聚焦报错={type(fill_prepare_error).__name__}: {fill_prepare_error}")
    if fill_error is not None:
        extra.append(f"fill报错={type(fill_error).__name__}: {fill_error}")
    if fill_read_error is not None:
        extra.append(f"fill回读报错={type(fill_read_error).__name__}: {fill_read_error}")
    if keyboard_prepare_error is not None:
        extra.append(f"keyboard聚焦报错={type(keyboard_prepare_error).__name__}: {keyboard_prepare_error}")
    if keyboard_error is not None:
        extra.append(f"keyboard报错={type(keyboard_error).__name__}: {keyboard_error}")
    if keyboard_read_error is not None:
        extra.append(f"keyboard回读报错={type(keyboard_read_error).__name__}: {keyboard_read_error}")
    if dom_error is not None:
        extra.append(f"dom报错={type(dom_error).__name__}: {dom_error}")
    if dom_read_error is not None:
        extra.append(f"dom回读报错={type(dom_read_error).__name__}: {dom_read_error}")
    if actual_normalized:
        extra.append(f"最终回读长度={len(actual_normalized)}")
        extra.append(f"最终回读预览={_preview_text(actual_normalized)}")
    suffix = f"；{'；'.join(extra)}" if extra else ""
    raise RuntimeError(f"输入框写入失败：页面没有接收文本{suffix}")

__all__ = ["_wait_for_reply_input_value", "_set_reply_input_via_dom", "_set_reply_input_via_page_dom", "_log_write_attempt", "overwrite_reply_input"]
