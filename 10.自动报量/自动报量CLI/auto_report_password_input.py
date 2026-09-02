from __future__ import annotations

import os
import sys
import threading
from dataclasses import dataclass
from getpass import getpass
from typing import Any, Callable, TextIO


@dataclass
class _PasswordDisplayState:
    """保存密码输入过程中的字符和当前显示状态。"""

    password_characters: list[str]
    last_character_is_visible: bool = False
    pending_mask_timer: Any | None = None


def _replace_visible_character_with_mask(
    password_display_state: _PasswordDisplayState,
    output_stream: TextIO,
) -> None:
    """把光标前仍可见的最后一个密码字符替换为星号。"""
    if not password_display_state.last_character_is_visible:
        return
    output_stream.write("\b*")
    output_stream.flush()
    password_display_state.last_character_is_visible = False


def read_password_with_delayed_mask(
    prompt_text: str,
    reveal_seconds: float = 1.0,
    character_reader: Callable[[], str] | None = None,
    output_stream: TextIO | None = None,
    timer_factory: Callable[[float, Callable[[], None]], Any] | None = None,
) -> str:
    """读取密码；新字符短暂显示，随后自动替换为星号。"""
    if character_reader is None:
        if os.name != "nt" or not sys.stdin.isatty() or not sys.stdout.isatty():
            return getpass(prompt_text)
        import msvcrt

        character_reader = msvcrt.getwch
    selected_output_stream = output_stream or sys.stdout
    selected_timer_factory = timer_factory or threading.Timer
    password_display_state = _PasswordDisplayState(password_characters=[])
    display_lock = threading.RLock()

    def cancel_pending_mask_timer() -> None:
        """取消上一字符尚未执行的遮罩计时。"""
        if password_display_state.pending_mask_timer is not None:
            password_display_state.pending_mask_timer.cancel()
            password_display_state.pending_mask_timer = None

    def mask_last_character_after_delay() -> None:
        """计时结束后安全遮住最后一个可见字符。"""
        with display_lock:
            _replace_visible_character_with_mask(
                password_display_state,
                selected_output_stream,
            )
            password_display_state.pending_mask_timer = None

    def schedule_last_character_mask() -> None:
        """为刚输入的字符启动一秒遮罩计时。"""
        mask_timer = selected_timer_factory(
            reveal_seconds,
            mask_last_character_after_delay,
        )
        if hasattr(mask_timer, "daemon"):
            mask_timer.daemon = True
        password_display_state.pending_mask_timer = mask_timer
        mask_timer.start()

    selected_output_stream.write(prompt_text)
    selected_output_stream.flush()
    while True:
        input_character = character_reader()
        with display_lock:
            if input_character in {"\r", "\n"}:
                cancel_pending_mask_timer()
                _replace_visible_character_with_mask(
                    password_display_state,
                    selected_output_stream,
                )
                selected_output_stream.write("\n")
                selected_output_stream.flush()
                return "".join(password_display_state.password_characters)
            if input_character == "\x03":
                cancel_pending_mask_timer()
                _replace_visible_character_with_mask(
                    password_display_state,
                    selected_output_stream,
                )
                selected_output_stream.write("\n")
                selected_output_stream.flush()
                raise KeyboardInterrupt
            if input_character == "\x1a":
                cancel_pending_mask_timer()
                raise EOFError
            if input_character in {"\x00", "\xe0"}:
                character_reader()
                continue
            if input_character == "\b":
                cancel_pending_mask_timer()
                if password_display_state.password_characters:
                    selected_output_stream.write("\b \b")
                    selected_output_stream.flush()
                    password_display_state.password_characters.pop()
                    password_display_state.last_character_is_visible = False
                continue
            if not input_character.isprintable():
                continue
            cancel_pending_mask_timer()
            _replace_visible_character_with_mask(
                password_display_state,
                selected_output_stream,
            )
            password_display_state.password_characters.append(input_character)
            password_display_state.last_character_is_visible = True
            selected_output_stream.write(input_character)
            selected_output_stream.flush()
            schedule_last_character_mask()
