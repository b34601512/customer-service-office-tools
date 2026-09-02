#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import math
import random
import time
from collections.abc import Callable
from typing import Protocol

from .config import AppConfig, TargetConfig
from .logger import log

_MODULE = "clipboard_relay.controller"


class ContentGeneratorLike(Protocol):
    def generate_sentence(self) -> str: ...


class DesktopLike(Protocol):
    def send_text_to_target(self, target: TargetConfig, text: str) -> None: ...


class HotkeyLike(Protocol):
    def poll(self): ...


class RelayController:
    def __init__(
        self,
        *,
        config: AppConfig,
        desktop: DesktopLike,
        hotkeys: HotkeyLike,
        content_generator: ContentGeneratorLike,
        status_callback: Callable[[dict[str, object]], None] | None = None,
    ) -> None:
        # 该控制器用于调度主流程，上层只管循环，下层只管具体动作。
        self._config = config
        self._desktop = desktop
        self._hotkeys = hotkeys
        self._content_generator = content_generator
        self._status_callback = status_callback
        self._paused = bool(config.start_paused)
        self._stop_requested = False
        self._work_started_at = time.monotonic()
        self._completed_rounds = 0
        self._last_status: tuple[str, int | None, int, int] | None = None

    def _handle_hotkeys(self) -> None:
        # 该函数用于处理暂停/继续/停止热键，确保长等待期间也能立即响应。
        events = self._hotkeys.poll()
        if bool(getattr(events, "pause_resume", False)):
            self._paused = not self._paused
            log("Control", "切换暂停状态", _MODULE, "_handle_hotkeys", paused=bool(self._paused))
        if bool(getattr(events, "stop", False)):
            self._stop_requested = True
            log("Control", "收到停止请求", _MODULE, "_handle_hotkeys")

    def _work_remaining_sec(self) -> float | None:
        # 该函数用于计算距离下一次休息还剩多少秒，供后台状态栏展示。
        work_duration = float(self._config.work_duration_sec)
        if work_duration <= 0:
            return None
        return max(0.0, work_duration - (time.monotonic() - float(self._work_started_at)))

    def _emit_status(self, phase: str, *, remaining_sec: float | None = None, force: bool = False) -> None:
        # 该函数用于向后台推送简洁状态，不把底层日志直接塞到主界面。
        if self._status_callback is None:
            return
        remaining = None if remaining_sec is None else int(math.ceil(max(0.0, float(remaining_sec))))
        total = int(self._config.rounds)
        signature = (str(phase), remaining, int(self._completed_rounds), total)
        if not force and signature == self._last_status:
            return
        self._last_status = signature
        self._status_callback(
            {
                "phase": str(phase),
                "remaining_sec": remaining,
                "completed_rounds": int(self._completed_rounds),
                "total_rounds": total,
            }
        )

    def _emit_work_status(self, *, force: bool = False) -> None:
        # 该函数用于展示工作中剩余时间，避免状态栏长时间不更新。
        self._emit_status("工作中", remaining_sec=self._work_remaining_sec(), force=force)

    def _wait_if_paused(self) -> None:
        # 该函数用于暂停主流程，但继续轮询热键让 F8/F9 生效。
        printed = False
        while bool(self._paused) and not bool(self._stop_requested):
            if not printed:
                log("Control", "已暂停，等待 F8 继续", _MODULE, "_wait_if_paused")
                printed = True
            self._emit_status("暂停中")
            self._handle_hotkeys()
            time.sleep(0.1)

    def _sleep_with_control(self, seconds: float, *, reason: str) -> None:
        # 该函数用于替代固定死等，睡眠期间仍然响应暂停/停止。
        deadline = time.monotonic() + max(0.0, float(seconds))
        while time.monotonic() < deadline and not bool(self._stop_requested):
            remain = max(0.0, float(deadline - time.monotonic()))
            if reason == "工作休息":
                self._emit_status("休息中", remaining_sec=remain)
            else:
                self._emit_work_status()
            self._handle_hotkeys()
            self._wait_if_paused()
            time.sleep(min(0.1, remain))
        log("Control", "间隔等待完成", _MODULE, "_sleep_with_control", reason=reason, seconds=float(seconds))

    def _target_delay(self, target: TargetConfig) -> float:
        # 该函数用于计算发送间隔：固定延迟加随机延迟范围，避免节奏过于机械。
        base = max(0.0, float(target.send_delay_sec))
        random_min = max(0.0, float(target.send_delay_random_min_sec))
        random_max = max(random_min, float(target.send_delay_random_max_sec))
        return float(base + random.uniform(random_min, random_max))

    def _rest_if_needed(self) -> None:
        # 该函数用于按“工作一段时间后休息一段时间”的节奏暂停，但不减少总轮数。
        work_duration = float(self._config.work_duration_sec)
        rest_duration = float(self._config.rest_duration_sec)
        if work_duration <= 0 or rest_duration <= 0:
            return
        elapsed = time.monotonic() - float(self._work_started_at)
        if elapsed < work_duration:
            return
        log("Control", "进入休息", _MODULE, "_rest_if_needed", worked_seconds=round(elapsed, 2), rest_seconds=rest_duration)
        self._emit_status("休息中", remaining_sec=rest_duration, force=True)
        self._sleep_with_control(rest_duration, reason="工作休息")
        self._work_started_at = time.monotonic()
        self._emit_work_status(force=True)
        log("Control", "休息结束", _MODULE, "_rest_if_needed")

    def _generate_text_for_target(self, target: TargetConfig) -> str:
        # 该函数用于直接生成本轮待发送文本，彻底切断对系统剪切板的依赖。
        text = str(self._content_generator.generate_sentence() or "").strip()
        if not text:
            raise RuntimeError(f"内容生成失败：{target.name} 收到空文本")
        log("Generator", "生成待发送内容", _MODULE, "_generate_text_for_target", target=target.name, length=len(text))
        return text

    def _send_one(self, target: TargetConfig, text: str) -> None:
        # 该函数用于发送单个目标，确保发送动作统一走 desktop 引擎。
        self._emit_work_status(force=True)
        log("Relay", "准备发送", _MODULE, "_send_one", target=target.name, length=len(str(text or "")))
        self._desktop.send_text_to_target(target, str(text))
        self._sleep_with_control(self._target_delay(target), reason=f"{target.name}/发送后间隔")

    def run(self) -> None:
        # 该函数用于执行网页端与京东客服端交替发送的主循环。
        self._emit_status("启动中", force=True)
        self._wait_if_paused()
        if bool(self._stop_requested):
            log("Relay", "启动阶段已停止", _MODULE, "run.stopped_before_baseline")
            self._emit_status("已停止", force=True)
            return
        log("Relay", "启动规则：固定走内置内容直连发送", _MODULE, "run")
        self._emit_work_status(force=True)
        for round_index in range(1, int(self._config.rounds) + 1):
            if bool(self._stop_requested):
                break
            log("Relay", "开始轮次", _MODULE, "run.round_begin", round_index=round_index, total=self._config.rounds)
            web_text = self._generate_text_for_target(self._config.web_client)
            self._send_one(self._config.web_client, web_text)

            jd_text = self._generate_text_for_target(self._config.jd_service)
            self._send_one(self._config.jd_service, jd_text)
            # 休息只能放在客服端发送完成之后，避免客户侧刚有消息就进入休息导致客服回复超时。
            self._rest_if_needed()
            self._completed_rounds = int(round_index)
            self._emit_work_status(force=True)
            log("Relay", "完成轮次", _MODULE, "run.round_done", round_index=round_index, total=self._config.rounds)

        self._emit_status("已停止" if bool(self._stop_requested) else "已完成", force=True)
        log("Relay", "主循环结束", _MODULE, "run.done", stopped=bool(self._stop_requested))


__all__ = ["RelayController"]
