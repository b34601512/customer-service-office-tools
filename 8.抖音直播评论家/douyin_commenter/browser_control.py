#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import queue
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .browser_resolver import resolve_browser_executable
from .config import AccountProfileConfig, BrowserConfig, LiveRoomConfig
from .logger import log

_MODULE = "douyin_commenter.browser_control"
_INPUT_SELECTOR = "textarea, input[type='text'], [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox']"
# 直播评论输入框在页面右下角，窗口过高会被 Windows 任务栏遮挡，所以固定用较矮窗口打开。
_LIVE_ROOM_VIEWPORT = {"width": 1500, "height": 760}
_LIVE_ROOM_WINDOW_ARGS = ("--window-size=1500,840", "--window-position=40,40")
_FIND_COMMENT_INPUT_SCRIPT = """selector => {
  const nodes = Array.from(document.querySelectorAll(selector));
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };
  const editable = (el) => {
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    return tag === 'textarea' || (tag === 'input' && type === 'text') || el.isContentEditable || role === 'textbox';
  };
  let best = null;
  let visibleCount = 0;
  let editableCount = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const el = nodes[index];
    const rect = el.getBoundingClientRect();
    const tag = (el.tagName || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const label = [
      el.getAttribute('placeholder') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.innerText || '',
      el.textContent || '',
    ].join(' ');
    const isVisible = visible(el);
    const isEditable = editable(el);
    const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true';
    const readonly = Boolean(el.readOnly) || el.hasAttribute('readonly') || el.getAttribute('aria-readonly') === 'true';
    if (isVisible) visibleCount += 1;
    if (isEditable && !disabled && !readonly) editableCount += 1;
    if (!isVisible || !isEditable || disabled || readonly || rect.width < 90 || rect.height < 16) {
      continue;
    }
    if (/搜索|关键词|手机号|验证码|昵称|礼物|充值/.test(label)) {
      continue;
    }
    let score = rect.y * 10 + rect.x + rect.width;
    if (/与大家互动|互动|评论|说点|聊点|输入|发言|弹幕/.test(label)) score += 100000;
    if (rect.bottom > window.innerHeight * 0.66) score += 8000;
    if (rect.left > window.innerWidth * 0.45) score += 5000;
    if (tag === 'textarea' || role === 'textbox') score += 2000;
    const candidate = {
      index,
      tag,
      role,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
      label: label.replace(/\\s+/g, ' ').trim().slice(0, 80),
      score,
    };
    if (!best || candidate.score > best.score) best = candidate;
  }
  return { count: nodes.length, visible_count: visibleCount, editable_count: editableCount, best };
}"""
_FOCUS_COMMENT_INPUT_SCRIPT = """payload => {
  const nodes = Array.from(document.querySelectorAll(payload.selector));
  const node = nodes[Number(payload.index)];
  if (!node) return { ok: false, reason: '输入框节点不存在' };
  if (typeof node.scrollIntoView === 'function') {
    try { node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch (error) { node.scrollIntoView(); }
  }
  if (typeof node.focus === 'function') node.focus();
  const rect = node.getBoundingClientRect();
  return {
    ok: true,
    index: Number(payload.index),
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom,
  };
}"""
_READ_COMMENT_INPUT_SCRIPT = """payload => {
  const nodes = Array.from(document.querySelectorAll(payload.selector));
  const node = nodes[Number(payload.index)];
  if (!node) return '';
  return 'value' in node ? (node.value || '') : (node.innerText || node.textContent || '');
}"""
_FIND_SEND_BUTTON_SCRIPT = """inputRect => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };
  const textOf = (el) => [
    el.innerText || '',
    el.textContent || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('title') || '',
  ].join(' ').replace(/\\s+/g, ' ').trim();
  const nodes = Array.from(document.querySelectorAll('button, [role="button"], [aria-label], div, span, svg'));
  const candidates = [];
  for (const el of nodes) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 12 || rect.width > 140 || rect.height > 100) continue;
    const label = textOf(el);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const nearInputY = centerY >= inputRect.y - 28 && centerY <= inputRect.bottom + 28;
    const nearInputRight = centerX >= inputRect.right - 90 && centerX <= inputRect.right + 120;
    const hasSendLabel = /发送|提交|send/i.test(label);
    if (!hasSendLabel && !(nearInputY && nearInputRight)) continue;
    const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true';
    if (disabled) continue;
    let score = 0;
    if (hasSendLabel) score += 100000;
    if (nearInputY) score += 5000;
    if (nearInputRight) score += 5000;
    score -= Math.abs(centerY - (inputRect.y + inputRect.height / 2));
    score -= Math.abs(centerX - inputRect.right);
    candidates.push({
      label,
      score,
      tag: (el.tagName || '').toLowerCase(),
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      centerX,
      centerY,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return { found: false, reason: '未找到发送按钮' };
  return { found: true, best: candidates[0], candidates: candidates.slice(0, 5) };
}"""


@dataclass(frozen=True)
class BrowserPageState:
    room_name: str
    account_name: str
    title: str
    url: str
    profile_dir: Path


@dataclass
class _BrowserCommand:
    name: str
    args: tuple[Any, ...]
    kwargs: dict[str, Any]
    done: threading.Event
    result: Any = None
    error: BaseException | None = None


def _normalize_text(value: str) -> str:
    # 该函数用于统一比较输入框文本，避免零宽字符和换行差异造成误判。
    return str(value or "").replace("\u200b", "").replace("\u00a0", " ").replace("\r\n", "\n").strip()


def _prepare_comment_content(value: str) -> str:
    # 该函数用于把评论压成单行文本，避免直播输入框把换行识别成空回车。
    return " ".join(_normalize_text(value).split())


class BrowserControl:
    def __init__(self, *, profile_root: Path) -> None:
        # 该控制器把所有 Playwright 操作收口到一个线程，避免跨线程页面句柄崩溃。
        self._profile_root = Path(profile_root)
        self._commands: queue.Queue[_BrowserCommand | None] = queue.Queue()
        self._ready = threading.Event()
        self._closed = threading.Event()
        self._thread: threading.Thread | None = None
        self._startup_error: BaseException | None = None
        self._startup_lock = threading.RLock()

    def open_room(self, *, room: LiveRoomConfig, account: AccountProfileConfig, browser: BrowserConfig) -> BrowserPageState:
        # 该函数用于打开当前直播间，调用方无需关心 Playwright 线程细节。
        return self._call("open_room", room, account, browser)

    def send_comment(self, text: str) -> None:
        # 该函数用于把评论写入当前直播间输入框并点击发送。
        return self._call("send_comment", str(text or ""))

    def close_all(self) -> None:
        # 该函数用于关闭本工具打开的受控浏览器。
        if self._thread is not None and self._thread.is_alive():
            self._call("close_all", timeout_sec=10)

    def force_kill_profiles(self) -> None:
        # 该函数用于退出时精准清理本工具资料目录下的浏览器进程。
        killed = self._kill_processes_matching_path(self._profile_root)
        if killed:
            log("Browser", "强制清理受控浏览器", _MODULE, "force_kill_profiles", pids=",".join(killed))
        self._thread = None

    def stop(self) -> None:
        # 该函数用于停止浏览器控制线程。
        if self._thread is None:
            return
        if self._thread.is_alive():
            self._commands.put(None)
            self._closed.wait(timeout=10)
        self._thread = None

    def _call(self, name: str, *args: Any, timeout_sec: float | None = None, **kwargs: Any) -> Any:
        # 该函数用于把外部调用转成线程内命令，并把异常原样抛回上层。
        self._start()
        command = _BrowserCommand(name=name, args=tuple(args), kwargs=dict(kwargs), done=threading.Event())
        self._commands.put(command)
        completed = command.done.wait(timeout=None if timeout_sec is None else max(0.1, float(timeout_sec)))
        if not completed:
            raise RuntimeError(f"浏览器控制命令超时：{name}")
        if command.error is not None:
            raise command.error
        return command.result

    def _start(self) -> None:
        # 该函数用于懒启动控制线程，后台打开时不立刻占用浏览器资源。
        with self._startup_lock:
            if self._thread is None or not self._thread.is_alive():
                self._ready.clear()
                self._closed.clear()
                self._startup_error = None
                self._thread = threading.Thread(target=self._worker_main, name="douyin-browser-control", daemon=True)
                self._thread.start()
                log("Browser", "启动控制线程", _MODULE, "_start", thread_name=self._thread.name)
        while not self._ready.wait(timeout=0.2):
            if self._thread is None or not self._thread.is_alive():
                break
        if self._startup_error is not None:
            raise RuntimeError(f"浏览器控制线程启动失败：{self._startup_error}") from self._startup_error

    def _worker_main(self) -> None:
        # 该函数用于在线程内持有 Playwright 对象和受控页面。
        playwright = None
        context = None
        page = None
        current_profile_dir: Path | None = None
        try:
            from playwright.sync_api import sync_playwright

            playwright = sync_playwright().start()
            self._ready.set()
            log("Browser", "控制线程已就绪", _MODULE, "_worker_main.ready")
            while True:
                command = self._commands.get()
                if command is None:
                    context = self._close_context(context)
                    return
                try:
                    if command.name == "open_room":
                        context, page, current_profile_dir, command.result = self._do_open_room(playwright, context, *command.args)
                    elif command.name == "send_comment":
                        command.result = self._do_send_comment(page, *command.args)
                    elif command.name == "close_all":
                        context = self._close_context(context)
                        page = None
                        current_profile_dir = None
                        command.result = None
                    else:
                        raise RuntimeError(f"未知浏览器控制命令：{command.name}")
                except BaseException as exc:
                    command.error = exc
                finally:
                    command.done.set()
        except BaseException as exc:
            self._startup_error = exc
            self._ready.set()
            log("Browser", "控制线程启动失败", _MODULE, "_worker_main.failed", reason=str(exc))
        finally:
            self._close_context(context)
            if playwright is not None:
                playwright.stop()
            self._closed.set()

    def _do_open_room(
        self,
        playwright: Any,
        context: Any,
        room: LiveRoomConfig,
        account: AccountProfileConfig,
        browser: BrowserConfig,
    ) -> tuple[Any, Any, Path, BrowserPageState]:
        # 该函数用于按账号资料目录打开直播间，账号之间物理隔离 Cookie。
        executable = resolve_browser_executable(browser.executable_path)
        profile_dir = self._profile_root / "douyin" / account.profile_key
        profile_dir.mkdir(parents=True, exist_ok=True)
        context = self._close_context(context)
        self._close_stale_profile_processes(profile_dir)
        log("Browser", "打开直播间", _MODULE, "_do_open_room.launch", room=room.name, account=account.name, profile=str(profile_dir), url=room.url)
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            executable_path=executable,
            headless=False,
            locale="zh-CN",
            viewport=dict(_LIVE_ROOM_VIEWPORT),
            args=[
                *_LIVE_ROOM_WINDOW_ARGS,
                "--disable-blink-features=AutomationControlled",
                "--no-default-browser-check",
                "--disable-popup-blocking",
            ],
        )
        context.set_default_timeout(10000)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(room.url, wait_until="domcontentloaded", timeout=60000)
        state = BrowserPageState(room_name=room.name, account_name=account.name, title=str(page.title() or ""), url=str(page.url or ""), profile_dir=profile_dir)
        log("Browser", "直播间已打开", _MODULE, "_do_open_room.opened", title=state.title, url=state.url)
        return context, page, profile_dir, state

    def _do_send_comment(self, page: Any, text: str) -> None:
        # 该函数用于定位直播评论输入框，写入后验证，再触发发送。
        if page is None or page.is_closed():
            raise RuntimeError("发送失败：直播间页面尚未打开或已被关闭。")
        content = _prepare_comment_content(text)
        if not content:
            raise RuntimeError("发送失败：评论内容为空。")
        page.bring_to_front()
        input_state = self._wait_for_comment_input(page, timeout_sec=45)
        best = input_state["best"]
        write_mode = self._write_comment_input(page, best, content)
        sent_by = self._send_written_comment(page, best, content)
        log("Browser", "评论发送完成", _MODULE, "_do_send_comment", length=len(content), write_mode=write_mode, sent_by=sent_by)

    def _write_comment_input(self, page: Any, best: dict[str, Any], content: str) -> str:
        # 该函数用于按真实用户输入顺序写入评论，避免只改 DOM 导致发送按钮未激活。
        focus_result = page.evaluate(_FOCUS_COMMENT_INPUT_SCRIPT, {"selector": _INPUT_SELECTOR, "index": int(best["index"])})
        if not isinstance(focus_result, dict) or not bool(focus_result.get("ok")):
            raise RuntimeError(f"聚焦评论输入框失败：{focus_result}")
        left = float(focus_result.get("x") or best.get("x") or 0)
        top = float(focus_result.get("y") or best.get("y") or 0)
        width = max(1.0, float(focus_result.get("width") or best.get("width") or 1))
        height = max(1.0, float(focus_result.get("height") or best.get("height") or 1))
        click_x = left + (width / 2 if width <= 16 else min(max(width * 0.35, 8), width - 8))
        click_y = top + height / 2
        page.mouse.click(click_x, click_y)
        page.keyboard.press("Control+A")
        page.keyboard.press("Backspace")
        page.keyboard.insert_text(content)
        ok, actual = self._wait_for_comment_value(page, best, content, timeout_sec=2.0)
        if not ok:
            raise RuntimeError(f"写入评论失败：页面回读不一致，期望 {len(content)} 字，实际 {len(actual)} 字。")
        log("Browser", "评论写入完成", _MODULE, "_write_comment_input", length=len(content), x=round(click_x, 1), y=round(click_y, 1))
        return "keyboard"

    def _send_written_comment(self, page: Any, best: dict[str, Any], content: str) -> str:
        # 该函数用于在确认输入框已有内容后发送，避免空输入状态下回车变成换行。
        page.keyboard.press("Enter")
        cleared, after_value = self._wait_for_comment_value_to_change(page, best, content, timeout_sec=1.8)
        if cleared:
            return "enter"

        send_result = page.evaluate(_FIND_SEND_BUTTON_SCRIPT, best)
        if isinstance(send_result, dict) and bool(send_result.get("found")) and isinstance(send_result.get("best"), dict):
            button = send_result["best"]
            page.mouse.click(float(button.get("centerX") or 0), float(button.get("centerY") or 0))
            cleared, after_value = self._wait_for_comment_value_to_change(page, best, content, timeout_sec=1.8)
            if cleared:
                log("Browser", "回车未发送后改点发送按钮成功", _MODULE, "_send_written_comment.button_fallback", label=str(button.get("label") or ""), tag=str(button.get("tag") or ""))
                return "button_fallback"

        raise RuntimeError(
            "发送后输入框仍保留原文本，可能未登录、发送按钮不可用，或页面拦截了评论；"
            f"当前输入框长度={len(after_value)}。"
        )

    def _read_comment_input(self, page: Any, best: dict[str, Any]) -> str:
        # 该函数用于读取当前评论输入框内容，给写入和发送验证共用。
        return _normalize_text(str(page.evaluate(_READ_COMMENT_INPUT_SCRIPT, {"selector": _INPUT_SELECTOR, "index": int(best["index"])}) or ""))

    def _wait_for_comment_value(self, page: Any, best: dict[str, Any], expected: str, *, timeout_sec: float) -> tuple[bool, str]:
        # 该函数用于等待输入框回读匹配，避免页面异步更新导致误判。
        deadline = time.monotonic() + max(0.2, float(timeout_sec))
        actual = ""
        while time.monotonic() < deadline:
            actual = self._read_comment_input(page, best)
            if actual == expected:
                return True, actual
            time.sleep(0.1)
        return False, actual

    def _wait_for_comment_value_to_change(self, page: Any, best: dict[str, Any], previous: str, *, timeout_sec: float) -> tuple[bool, str]:
        # 该函数用于等待发送后输入框脱离原文本，避免固定睡眠判断不准。
        deadline = time.monotonic() + max(0.2, float(timeout_sec))
        actual = previous
        while time.monotonic() < deadline:
            actual = self._read_comment_input(page, best)
            if actual != previous:
                return True, actual
            time.sleep(0.1)
        return False, actual

    def _wait_for_comment_input(self, page: Any, *, timeout_sec: float) -> dict[str, Any]:
        # 该函数用于按页面真实状态等待评论输入框，而不是固定睡眠硬猜。
        deadline = time.monotonic() + max(1.0, float(timeout_sec))
        last_state: dict[str, Any] | None = None
        last_log_at = 0.0
        while time.monotonic() < deadline:
            state = page.evaluate(_FIND_COMMENT_INPUT_SCRIPT, _INPUT_SELECTOR)
            if isinstance(state, dict):
                last_state = state
                if isinstance(state.get("best"), dict):
                    best = state["best"]
                    log("Browser", "找到评论输入框", _MODULE, "_wait_for_comment_input.found", x=round(float(best.get("x") or 0), 1), y=round(float(best.get("y") or 0), 1), label=str(best.get("label") or ""))
                    return state
            now = time.monotonic()
            if now - last_log_at >= 3.0:
                last_log_at = now
                log(
                    "Browser",
                    "等待评论输入框",
                    _MODULE,
                    "_wait_for_comment_input.waiting",
                    candidates=int((last_state or {}).get("count") or 0),
                    visible=int((last_state or {}).get("visible_count") or 0),
                    editable=int((last_state or {}).get("editable_count") or 0),
                )
            time.sleep(0.2)
        summary = last_state or {}
        raise RuntimeError(
            "未找到直播评论输入框：请确认已登录抖音、直播间已打开，且评论输入框在页面右下方可见；"
            f"候选={int(summary.get('count') or 0)}，可见={int(summary.get('visible_count') or 0)}，可编辑={int(summary.get('editable_count') or 0)}。"
        )

    def _close_context(self, context: Any) -> Any:
        # 该函数用于关闭当前受控浏览器上下文，忽略用户已手动关闭的正常情况。
        if context is None:
            return None
        try:
            context.close()
            log("Browser", "关闭受控浏览器", _MODULE, "_close_context")
        except BaseException as exc:
            log("Browser", "关闭受控浏览器失败", _MODULE, "_close_context.failed", reason=str(exc))
        return None

    def _close_stale_profile_processes(self, profile_dir: Path) -> None:
        # 该函数用于清理旧版本异常退出后残留的同资料目录进程。
        killed = self._kill_processes_matching_path(profile_dir)
        if killed:
            log("Browser", "清理残留受控浏览器", _MODULE, "_close_stale_profile_processes", profile=str(profile_dir), pids=",".join(killed))

    @staticmethod
    def _kill_processes_matching_path(path: Path) -> list[str]:
        # 该函数用于按命令行里的资料目录精准清理进程，不触碰用户普通浏览器。
        needle = str(Path(path))
        script = f"""
$needle = @'
{needle}
'@
$needleLower = $needle.ToLower()
Get-CimInstance Win32_Process |
  Where-Object {{ $_.CommandLine -and $_.CommandLine.ToLower().Contains($needleLower) }} |
  ForEach-Object {{
    try {{
      Stop-Process -Id $_.ProcessId -Force
      Write-Output $_.ProcessId
    }} catch {{}}
  }}
"""
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return [item.strip() for item in str(result.stdout or "").splitlines() if item.strip()]


__all__ = ["BrowserControl", "BrowserPageState"]
