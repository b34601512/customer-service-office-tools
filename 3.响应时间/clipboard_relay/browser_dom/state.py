#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from .scripts import (
    _REPLY_INPUT_META_SCRIPT,
    _REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS,
    _REPLY_INPUT_READY_SCRIPT,
    _REPLY_INPUT_SELECTOR,
    _REPLY_INPUT_STATE_SCRIPT,
)

def _read_reply_input_state(page: Any) -> dict[str, Any]:
    # 该函数用于一次性读取 DOM 里的输入框状态，避免逐个 locator 等待导致误超时。
    state = page.evaluate(_REPLY_INPUT_STATE_SCRIPT, _REPLY_INPUT_SELECTOR)
    if not isinstance(state, dict):
        raise RuntimeError(f"读取输入框状态失败：页面返回了非对象状态，当前值={state!r}")
    return state


def _reply_input_state_summary(state: dict[str, Any] | None) -> str:
    # 该函数用于把最后一次 DOM 状态压缩进异常，方便按候选数量排查页面状态。
    if not state:
        return "未读取到输入框状态"
    return (
        f"候选={int(state.get('count') or 0)}"
        f"，可见={int(state.get('visible_count') or 0)}"
        f"，可编辑={int(state.get('editable_count') or 0)}"
    )


def _bool_text(value: object) -> str:
    # 该函数用于把布尔状态写成中文日志，方便直接从日志判断卡在哪个状态。
    return "是" if bool(value) else "否"


def _read_reply_input_ready_state(locator: Any) -> dict[str, Any]:
    # 该函数用于读取输入框写入前状态，避免页面卡顿或重绘时直接点击超时。
    state = locator.evaluate(_REPLY_INPUT_READY_SCRIPT, timeout=_REPLY_INPUT_READY_EVALUATE_TIMEOUT_MS)
    if not isinstance(state, dict):
        raise RuntimeError(f"读取输入框点击状态失败：页面返回了非对象状态，当前值={state!r}")
    return state


def _reply_input_ready_summary(state: dict[str, Any] | None) -> str:
    # 该函数用于把写入前状态压缩进日志和异常，直接暴露输入框为何没就绪。
    if not state:
        return "未读取到输入框点击状态"
    return (
        f"原因={state.get('reason') or '未知'}"
        f"，可见={_bool_text(state.get('visible'))}"
        f"，可编辑={_bool_text(state.get('editable'))}"
        f"，禁用={_bool_text(state.get('disabled'))}"
        f"，只读={_bool_text(state.get('readonly'))}"
        f"，在可视区={_bool_text(state.get('in_viewport'))}"
    )


def _default_reply_input_meta() -> dict[str, Any]:
    # 该函数用于在页面极度卡顿时提供最小元信息，避免诊断日志本身阻断发送。
    return {
        "tag": "",
        "type": "",
        "role": "",
        "maxlength": -1,
        "placeholder": "",
        "aria": "",
        "title": "",
        "editable": False,
    }


def _meta_from_reply_input_state(state: dict[str, Any] | None) -> dict[str, Any] | None:
    # 该函数用于从页面级状态里提取输入框元信息，避免为读元信息再次等待 locator。
    if not state:
        return None
    best = state.get("best")
    if not isinstance(best, dict):
        return None
    meta = _default_reply_input_meta()
    for key in ("tag", "type", "role", "maxlength", "placeholder", "aria", "title", "editable"):
        if key in best:
            meta[key] = best.get(key)
    return meta


def _combine_errors(*named_errors: tuple[str, BaseException | None]) -> BaseException | None:
    # 该函数用于把同一动作里的原始错误串起来，避免回退流程掩盖真正失败点。
    parts = [f"{name}={type(error).__name__}: {error}" for name, error in named_errors if error is not None]
    if not parts:
        return None
    return RuntimeError("；".join(parts))

__all__ = ["_read_reply_input_state", "_reply_input_state_summary", "_bool_text", "_read_reply_input_ready_state", "_reply_input_ready_summary", "_default_reply_input_meta", "_meta_from_reply_input_state", "_combine_errors"]
