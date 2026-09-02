"""电话漏接分析的全屏 TUI 框架。

参考“客服超时督办”的 TUI 交互：顶部标题、状态栏、菜单栏、内容区、
底部快捷键提示，支持上下左右键切换和选择。本模块只负责终端框架与页面调度，
具体业务页面由页面对象提供 render/handle_key。
"""
from __future__ import annotations

import os
import shutil
import sys
import time
from typing import Any, Callable, Sequence

from . import cli_display
from .cli_display import (
    colorize,
    fit_text,
)

# 游戏化提示音总开关：False 时所有操作不发声（仅保留视觉反馈）。
SOUND_ENABLED = True


def _fit(text: object, width: int, truncate: bool = True) -> str:
    """把一行文本按终端宽度补齐。

    truncate=False 时只补短行、不截长行，用于表格等内容完整展示。
    """
    return fit_text(text, width, truncate)


class Page:
    """TUI 页面基类。"""

    key = ""
    title = ""
    # 页面存在后台持续变化（如下载进度）时置为 True，空闲时也保持定时刷新；
    # 其余页面空闲时完全不重绘，避免打断鼠标选择复制。
    periodic_refresh = False

    def __init__(self) -> None:
        self.state: dict[str, Any] = {}

    def on_enter(self, app: "TuiApp") -> None:
        """进入页面时回调，可用来重置滚动或重新加载数据。"""

    def render(self, app: "TuiApp") -> list[str]:
        """返回内容区文本行，不要包含终端控制序列以外的格式。"""
        return []

    def handle_key(self, key: str, app: "TuiApp") -> bool:
        """处理按键，返回 True 表示已消费。"""
        return False

    def footer(self, app: "TuiApp") -> str:
        """返回底部快捷键提示。"""
        return ""


class TuiApp:
    """全屏 TUI 应用：负责原始按键、备用屏幕、帧渲染和页面切换。"""

    def __init__(
        self,
        title: str,
        pages: Sequence[Page],
        application: Any,
        status_provider: Callable[["TuiApp"], list[str]] | None = None,
        output: Any = None,
    ) -> None:
        self.title = title
        self.pages = list(pages)
        self.application = application
        self.status_provider = status_provider or (lambda _app: [])
        self.output = output or sys.stdout
        self.current_page_index = 0
        self.running = False
        self._terminal_started = False
        self._old_termios: Any = None
        self._windows_console_handler: Any = None
        self._windows_console_input_handle: Any = None
        self._windows_console_input_mode: int | None = None
        self._windows_console_output_handle: Any = None
        self._windows_console_output_mode: int | None = None
        self._last_output = ""
        self._render_requested = False
        self._toast = ""
        self._toast_at = 0.0

    @property
    def page(self) -> Page | None:
        if 0 <= self.current_page_index < len(self.pages):
            return self.pages[self.current_page_index]
        return None

    @property
    def columns(self) -> int:
        # 优先读输出对象自带的宽度（测试桩等），否则查询真实终端宽度。
        # 注意不要用 self.output.columns 直接取值：sys.stdout 没有该属性，
        # 直接访问会抛 AttributeError 导致宽度永远退化为 80，选中行高亮铺不满整行。
        width = getattr(self.output, "columns", 0) or 0
        if width <= 0:
            try:
                width = shutil.get_terminal_size(fallback=(80, 24)).columns
            except (AttributeError, OSError, ValueError):
                width = 80
        return max(48, width)

    @property
    def rows(self) -> int:
        height = getattr(self.output, "rows", 0) or 0
        if height <= 0:
            try:
                height = shutil.get_terminal_size(fallback=(80, 24)).lines
            except (AttributeError, OSError, ValueError):
                height = 24
        return max(14, height)

    @property
    def content_height(self) -> int:
        # 标题 1 + 状态 2 + 菜单 1 + 分隔 1 + 联系方式 1 + 版权 1 + 页脚 1 + 底边 1 = 9 行
        return max(4, self.rows - 9)

    def _handle_windows_console_control(self, control_type: int) -> int:
        """接收 Windows 控制台关闭事件，让主循环走统一的 finally 清理路径。"""
        # CTRL_C_EVENT=0、CTRL_BREAK_EVENT=1、CTRL_CLOSE_EVENT=2，
        # CTRL_LOGOFF_EVENT=5、CTRL_SHUTDOWN_EVENT=6。
        if control_type in (0, 1, 2, 5, 6):
            self.running = False
            if control_type in (2, 5, 6) and hasattr(self.application, "_console_close_requested"):
                self.application._console_close_requested = True
            return 1
        return 0

    def _configure_windows_console_modes(self) -> None:
        """进入 TUI 时关闭 QuickEdit，并开启 Windows ANSI 输出；退出时恢复。"""
        if os.name != "nt":
            return
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32
            handler_type = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_uint)
            handler = handler_type(self._handle_windows_console_control)
            if kernel32.SetConsoleCtrlHandler(handler, True):
                self._windows_console_handler = handler
            # STD_INPUT_HANDLE=-10，STD_OUTPUT_HANDLE=-11。
            input_handle = kernel32.GetStdHandle(-10)
            input_mode = ctypes.c_uint()
            if input_handle and kernel32.GetConsoleMode(input_handle, ctypes.byref(input_mode)):
                # ENABLE_PROCESSED_INPUT/LINE_INPUT/ECHO_INPUT/MOUSE_INPUT/INSERT/QUICK_EDIT。
                disable_input_flags = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020 | 0x0040
                next_input_mode = (input_mode.value | 0x0080) & ~disable_input_flags
                if kernel32.SetConsoleMode(input_handle, next_input_mode):
                    self._windows_console_input_handle = input_handle
                    self._windows_console_input_mode = input_mode.value

            output_handle = kernel32.GetStdHandle(-11)
            output_mode = ctypes.c_uint()
            if output_handle and kernel32.GetConsoleMode(output_handle, ctypes.byref(output_mode)):
                # ENABLE_VIRTUAL_TERMINAL_PROCESSING=0x0004。
                next_output_mode = output_mode.value | 0x0004
                if kernel32.SetConsoleMode(output_handle, next_output_mode):
                    self._windows_console_output_handle = output_handle
                    self._windows_console_output_mode = output_mode.value
        except (AttributeError, OSError, TypeError):
            # Windows Terminal 伪控制台可能不提供传统句柄；此时保留 ANSI/按键的现有路径。
            return

    def _restore_windows_console_modes(self) -> None:
        """恢复进入 TUI 前的 Windows 控制台模式。"""
        if os.name != "nt":
            return
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32
            if self._windows_console_handler is not None:
                kernel32.SetConsoleCtrlHandler(self._windows_console_handler, False)
            if self._windows_console_input_handle is not None and self._windows_console_input_mode is not None:
                kernel32.SetConsoleMode(self._windows_console_input_handle, self._windows_console_input_mode)
            if self._windows_console_output_handle is not None and self._windows_console_output_mode is not None:
                kernel32.SetConsoleMode(self._windows_console_output_handle, self._windows_console_output_mode)
        except (AttributeError, OSError, TypeError):
            pass
        finally:
            self._windows_console_handler = None
            self._windows_console_input_handle = None
            self._windows_console_input_mode = None
            self._windows_console_output_handle = None
            self._windows_console_output_mode = None

    def start(self) -> None:
        if self.running:
            return
        self._configure_windows_console_modes()
        self._terminal_started = True
        self.running = True
        cli_display.COLOR_OUTPUT_ENABLED = True
        self.output.write("\x1b[?1049h\x1b[2J\x1b[?25l\x1b[?7l")
        try:
            self.output.flush()
        except (AttributeError, OSError):
            pass
        if os.name != "nt" and hasattr(sys.stdin, "fileno") and sys.stdin.isatty():
            import termios
            import tty

            self._old_termios = termios.tcgetattr(sys.stdin.fileno())
            tty.setraw(sys.stdin.fileno())
        if self.page and hasattr(self.page, "on_enter"):
            self.page.on_enter(self)
        self.render()

    def stop(self) -> None:
        """无论 running 当前值如何，都恢复 TUI 进入前的终端状态。"""
        if not self._terminal_started:
            return
        self.running = False
        try:
            if self._old_termios is not None:
                import termios

                termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, self._old_termios)
                self._old_termios = None
        except (AttributeError, OSError):
            self._old_termios = None
        try:
            self.output.write("\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l")
            self.output.flush()
        except (AttributeError, OSError):
            pass
        finally:
            self._restore_windows_console_modes()
            self._terminal_started = False

    def request_render(self) -> None:
        """请求主循环在下一次空闲轮询时刷新，供后台加载线程完成后使用。"""
        self._render_requested = True

    def feedback(self, message: str, beep: int | None = 880) -> None:
        """游戏化操作反馈：显示一条短暂提示，并可选播放提示音。

        beep 为提示音频率(Hz)，None 表示只显示提示不发声。
        """
        self.toast(message)
        if beep:
            self._beep(int(beep), 50)

    def toast(self, message: str) -> None:
        """记录一条操作提示，build_frame 会在状态区短暂显示。"""
        self._toast = message
        self._toast_at = time.monotonic()

    def _beep(self, frequency: int, duration: int) -> None:
        """Windows 提示音；非真实终端或播放失败时静默，不打断测试环境。"""
        if not SOUND_ENABLED:
            return
        isatty = getattr(self.output, "isatty", None)
        if isatty is not None and not isatty():
            return
        try:
            if os.name == "nt":
                import winsound

                winsound.Beep(frequency, duration)
        except Exception:
            pass

    def switch_page(self, index: int) -> None:
        target = int(index)
        if 0 <= target < len(self.pages):
            if target != self.current_page_index:
                self.current_page_index = target
                self.feedback(f"进入：{self.page.title}", beep=660)
            if self.page and hasattr(self.page, "on_enter"):
                self.page.on_enter(self)

    def run(self) -> None:
        if not sys.stdin.isatty():
            raise RuntimeError("TUI 界面需要真实终端输入；请在终端窗口中启动。")
        self.start()
        try:
            while self.running:
                key = self.read_key(timeout=0.2)
                if key is None:
                    # 空闲时不要反复清屏重绘：会把屏幕内容不断刷新，导致
                    # 鼠标无法选中文本、复制失效。后台任务完成时可主动请求一次刷新；
                    # 其余页面只有显式 periodic_refresh 才继续定时刷新。
                    if self._render_requested:
                        self._render_requested = False
                        self.render()
                    elif self.page and self.page.periodic_refresh:
                        self.render()
                    continue
                self.dispatch_key(key)
                self.render()
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()

    def read_key(self, timeout: float | None = None) -> str | None:
        """读取一个按键，Windows 使用 msvcrt，Linux/macOS 使用 termios 原始模式。

        timeout 大于 0 时最多等待这么多秒；超时返回 None，方便下载页定时刷新。
        """
        if os.name == "nt":
            import msvcrt
            import time as _time

            start = _time.monotonic()
            while True:
                if msvcrt.kbhit():
                    ch = msvcrt.getwch()
                    if ch in ("\x00", "\xe0"):
                        ch2 = msvcrt.getwch()
                        return {
                            "H": "up",
                            "P": "down",
                            "K": "left",
                            "M": "right",
                            "G": "home",
                            "O": "end",
                            "I": "pgup",
                            "Q": "pgdn",
                            "S": "delete",
                        }.get(ch2, ch2)
                    if ch == "\r":
                        return "enter"
                    if ch == "\x03":
                        return "ctrl-c"
                    if ch == "\x1b":
                        return "esc"
                    if ch in ("\x08", "\x7f"):
                        return "backspace"
                    if ch == "\t":
                        return "tab"
                    return ch
                if timeout is not None and _time.monotonic() - start >= timeout:
                    return None
                _time.sleep(0.03)

        # Unix 原始模式下的简易读取：支持方向键和常见控制键。
        import select
        import termios

        fd = sys.stdin.fileno()
        if not sys.stdin.isatty():
            return None
        ready, _, _ = select.select([fd], [], [], timeout if timeout is not None else 0.2)
        if not ready:
            return None
        data = os.read(fd, 1)
        if not data:
            return None
        char = data.decode("utf-8", errors="ignore")
        if char == "\x1b":
            # 尝试读取完整的 CSI 序列
            try:
                ready, _, _ = select.select([fd], [], [], 0.05)
                if not ready:
                    return "esc"
                seq = os.read(fd, 2).decode("utf-8", errors="ignore")
                if seq == "[A":
                    return "up"
                if seq == "[B":
                    return "down"
                if seq == "[C":
                    return "right"
                if seq == "[D":
                    return "left"
                if seq == "[H":
                    return "home"
                if seq == "[F":
                    return "end"
                if seq == "[5~":
                    return "pgup"
                if seq == "[6~":
                    return "pgdn"
                return "unknown"
            except OSError:
                return "esc"
        if char == "\r":
            return "enter"
        if char == "\x03":
            return "ctrl-c"
        if char in ("\x7f", "\x08"):
            return "backspace"
        if char == "\t":
            return "tab"
        return char

    def dispatch_key(self, key: str) -> None:
        if not key or key == "unknown":
            return

        if key == "ctrl-c":
            self.running = False
            return

        if self.page and self.page.handle_key(key, self):
            return

        if key in ("left", "right"):
            direction = 1 if key == "right" else -1
            self.switch_page((self.current_page_index + direction + len(self.pages)) % len(self.pages))
            return

        if key.isdigit():
            number = int(key)
            if 1 <= number <= len(self.pages):
                self.switch_page(number - 1)
                return

        if key == "q":
            self.switch_page(0)

    def build_menu_bar(self, columns: int) -> str:
        segments = []
        for index, page in enumerate(self.pages):
            label = f" {index + 1}{page.title} "
            if index == self.current_page_index:
                segments.append(colorize(label, "reverse"))
            else:
                segments.append(colorize(label, "brightBlue"))
        return _fit("".join(segments), columns)

    def build_frame(self) -> list[str]:
        columns = self.columns
        rows = self.rows
        content_height = self.content_height
        page = self.page
        page_title = f"{page.key}.{page.title}" if page else ""

        lines: list[str] = []
        title_bar = f" {self.title}  {('│ ' + page_title) if page_title else ''}"
        clock = time.strftime("%Y-%m-%d %H:%M:%S")
        lines.append(
            colorize(_fit(title_bar, columns - 21), "brightCyan")
            + colorize(_fit(f" {clock}", 21), "gray")
        )

        status_lines = self.status_provider(self) or []
        toast = ""
        if self._toast and time.monotonic() - self._toast_at < 1.5:
            toast = colorize("▶ " + self._toast, "brightYellow")
        for index in range(2):
            if index == 1 and toast:
                lines.append(_fit(toast, columns))
            else:
                lines.append(_fit(status_lines[index] if index < len(status_lines) else "", columns))

        lines.append(self.build_menu_bar(columns))
        lines.append(colorize("─" * columns, "gray"))

        content_lines = page.render(self) if page else []
        for content_line in content_lines:
            lines.append(_fit(content_line, columns, truncate=False))

        lines.append(colorize(_fit("作者：黎路遥 ｜ 微信：luyao2089 ｜ 官网：luyao2089.cc", columns), "gray"))
        lines.append(colorize(_fit("版权所有 © 黎路遥，保留所有权利", columns), "gray"))
        footer_text = page.footer(self) if page and hasattr(page, "footer") else ""
        footer = footer_text or "↑↓选择 回车执行 ←→/数字键切页 9退出页 Ctrl+C直接退出"
        lines.append(colorize(_fit(footer, columns), "gray"))
        lines.append("─" * columns)
        return lines

    def render(self) -> None:
        if not self.running:
            return
        frame_lines = self.build_frame()
        output = "\x1b[H\x1b[J" + "\r\n".join(frame_lines)
        if output == self._last_output:
            # 内容未变化时跳过写入，避免同一秒内重复清屏打断选择。
            return
        self._last_output = output
        self.output.write(output)
        try:
            self.output.flush()
        except (AttributeError, OSError):
            pass
