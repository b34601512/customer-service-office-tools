#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
boss_tui.py —— BOSS直聘采集工具 终端图形界面（参考 1.客服超时督办 的 TUI 交互）
  交互：↑↓ 选择 / ←→ 切页 / 回车执行 / 数字键切页 / Ctrl+C 直接退出
  布局：标题栏+时钟 / 状态栏 / 菜单栏 / 分隔线 / 内容区 / 版权 / 页脚 / 底边
  业务真源：直接 import boss_cdp（登录、抓取、导出全走同一份 Edge 业务代码）
  运行：python boss_tui.py   （仅 Windows 控制台，纯标准库，无第三方依赖）
"""

import contextlib
import glob
import io
import os
import shutil
import subprocess
import sys
import threading
import time
import unicodedata

import boss_cdp as biz  # 业务真源（BOSS 采集核心）
import merchant_subjects
import shop_subjects

APP_VERSION = "v9"

# ---------------------------------------------------------------- ANSI 工具
ESC = "\x1b"
CODES = {
    "reset": f"{ESC}[0m", "bold": f"{ESC}[1m", "dim": f"{ESC}[2m", "underline": f"{ESC}[4m",
    "reverse": f"{ESC}[7m", "black": f"{ESC}[30m", "red": f"{ESC}[31m", "green": f"{ESC}[32m",
    "yellow": f"{ESC}[33m", "blue": f"{ESC}[34m", "magenta": f"{ESC}[35m", "cyan": f"{ESC}[36m",
    "white": f"{ESC}[37m", "gray": f"{ESC}[90m", "brightRed": f"{ESC}[91m",
    "brightGreen": f"{ESC}[92m", "brightYellow": f"{ESC}[93m", "brightBlue": f"{ESC}[94m",
    "brightCyan": f"{ESC}[96m", "bgRed": f"{ESC}[41m", "bgGreen": f"{ESC}[42m", "bgYellow": f"{ESC}[43m",
    "hideCursor": f"{ESC}[?25l", "showCursor": f"{ESC}[?25h",
    "enterAltScreen": f"{ESC}[?1049h", "leaveAltScreen": f"{ESC}[?1049l",
    "clearScreen": f"{ESC}[2J", "cursorHome": f"{ESC}[H",
}
ANSI_PATTERN = r"\x1b\[[0-9;]*[A-Za-z]"
ANSI_TOKEN_PATTERN = r"^\x1b\[[0-9;]*[A-Za-z]$"
ANSI_PART_PATTERN = r"(\x1b\[[0-9;]*[A-Za-z])"

WIDE_RANGES = [
    (0x1100, 0x115F), (0x2E80, 0x303E), (0x3041, 0x33FF), (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF), (0xA000, 0xA4CF), (0xAC00, 0xD7A3), (0xF900, 0xFAFF),
    (0xFE30, 0xFE4F), (0xFF00, 0xFF60), (0xFFE0, 0xFFE6), (0x1F300, 0x1FAFF),
]


def is_wide_char(ch):
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in WIDE_RANGES)


def _is_zero_width(ch):
    # 组合附加符（Mn/Me）与零宽控制字符按 0 列计
    return unicodedata.category(ch) in ("Mn", "Me") or unicodedata.category(ch) == "Cf"


def display_width(text):
    import re
    text = re.sub(ANSI_PATTERN, "", str(text))
    width = 0
    for ch in text:
        if _is_zero_width(ch):
            continue
        width += 2 if is_wide_char(ch) else 1
    return width


def colorize(text, color):
    code = CODES.get(color)
    return f"{code}{text}{CODES['reset']}" if code else str(text)


def pad_end(text, width, fill=" "):
    text = str(text)
    current = display_width(text)
    if current >= width:
        return text
    return text + fill * (width - current)


def pad_start(text, width, fill=" "):
    text = str(text)
    current = display_width(text)
    if current >= width:
        return text
    return fill * (width - current) + text


def truncate(text, width):
    import re
    text = str(text)
    if display_width(text) <= width:
        return text
    if width <= 0:
        return ""
    max_content = max(0, width - display_width("…"))
    result, current, had_escape = "", 0, False
    parts = re.split(ANSI_PART_PATTERN, text)
    for part in parts:
        if not part:
            continue
        if re.match(ANSI_TOKEN_PATTERN, part):
            result += part
            had_escape = True
            continue
        for ch in part:
            w = 0 if _is_zero_width(ch) else (2 if is_wide_char(ch) else 1)
            if current + w > max_content:
                return f"{result}{CODES['reset'] if had_escape else ''}…"
            result += ch
            current += w
    return f"{result}{CODES['reset'] if had_escape else ''}…"


def fit(text, width, allow_truncate=True):
    text = str(text)
    if display_width(text) <= width:
        return pad_end(text, width)
    if not allow_truncate:
        return text
    return pad_end(truncate(text, width), width)


def move_to(row, col):
    return f"{ESC}[{row};{col}H"


def clear_line():
    return f"{ESC}[2K"


def format_clock():
    return time.strftime("%H:%M:%S")


def spinner_frame(rate=4.0):
    """等待期间的旋转动画，按时间取帧，避免误以为程序无响应。"""
    frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    return frames[int(time.monotonic() * rate) % len(frames)]


def format_progress_bar(current, total, width=24):
    """已知总量显示进度条；未知总量显示移动标记，避免伪造百分比。"""
    width = max(8, int(width))
    total = int(total or 0)
    current = max(0, int(current or 0))
    if total <= 0:
        position = int(time.monotonic() * 4) % width
        cells = ["░"] * width
        cells[position] = "▰"
        return f"[{''.join(cells)}]  --%"
    current = min(current, total)
    filled = round(current / total * width)
    return f"[{'▰' * filled}{'▱' * (width - filled)}]  {round(current / total * 100):>3}%"


def format_elapsed(seconds):
    seconds = max(0, int(seconds or 0))
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}时{minutes:02d}分{seconds:02d}秒"
    if minutes:
        return f"{minutes}分{seconds:02d}秒"
    return f"{seconds}秒"


# ---------------------------------------------------------------- TUI 核心（对齐 1 号项目交互）
class TuiApp:
    def __init__(self, title, pages, output=None, on_exit_request=None, status_bar_provider=None,
                 footer_provider=None):
        self.title = title
        self.pages = pages
        self.current_page_index = 0
        self.output = output or sys.stdout
        self.on_exit_request = on_exit_request or (lambda: None)
        self.status_bar_provider = status_bar_provider or (lambda app: [])
        self.footer_provider = footer_provider or (lambda app: "")
        self.running = False
        self.last_frame_lines = None
        self.escape_buffer = ""
        self._pending_console_chars = []
        self.last_cols = None
        self.last_rows = None
        self._last_tick = 0.0
        self._old_console_input_mode = None

    @property
    def page(self):
        return self.pages[self.current_page_index] if self.pages else None

    @property
    def columns(self):
        if hasattr(self.output, "columns") and self.output.columns:
            return max(48, int(self.output.columns))
        return max(48, shutil.get_terminal_size(fallback=(80, 24)).columns)

    @property
    def rows(self):
        if hasattr(self.output, "rows") and self.output.rows:
            return max(14, int(self.output.rows))
        return max(14, shutil.get_terminal_size(fallback=(80, 24)).lines)

    @property
    def content_height(self):
        # 帧布局：标题1 + 状态2 + 菜单1 + 分隔1 + 版权2 + 页脚1 + 底边1 = 9 行
        return max(4, self.rows - 9)

    def switch_page(self, index):
        target = int(index)
        if 0 <= target < len(self.pages):
            self.current_page_index = target
            if callable(getattr(self.page, "on_enter", None)):
                self.page.on_enter(self)
            self.request_render()

    def start(self):
        if self.running:
            return
        # 启用 Windows 控制台 VT 模式（备用屏幕/光标控制依赖）
        try:
            os.system("")
        except Exception:
            pass
        self.running = True
        self.last_frame_lines = None
        if callable(getattr(self.page, "on_enter", None)):
            self.page.on_enter(self)
        if not self._interactive_terminal():
            # 非交互环境（AI 自动化 / 管道重定向 / 测试）：渲染一帧供外部捕获后返回，
            # 不进入 msvcrt 按键循环，避免无限阻塞（SoftTalk #2705 可自动化原则）。
            self.request_render()
            return
        self._prepare_console_input()
        self.output.write(CODES["enterAltScreen"] + CODES["clearScreen"] + CODES["hideCursor"] + "\x1b[?7l")
        import msvcrt
        self._last_tick = time.monotonic()
        while self.running:
            if msvcrt.kbhit() or self._pending_console_chars:
                key = self._read_windows_key(msvcrt)
                if key:
                    self.dispatch_key(key)
                continue
            # 定时渲染（对齐 1 号项目：每秒一次，时钟/任务状态刷新；按键已即时渲染）
            now = time.monotonic()
            if now - self._last_tick >= 1.0:
                self._last_tick = now
                self.request_render()
            time.sleep(0.05)

    @staticmethod
    def _interactive_terminal():
        try:
            return bool(sys.stdin.isatty()) and bool(sys.stdout.isatty())
        except Exception:
            return False

    def _read_windows_key(self, msvcrt):
        """读取一个 Windows 控制台按键；单独 Esc 必须立即结束转义状态，不能吞掉后续文字。"""
        if self._pending_console_chars:
            ch = self._pending_console_chars.pop(0)
        else:
            ch = msvcrt.getwch()

        if ch in ("\xe0", "\x00"):
            return self._ext_key(msvcrt.getwch())
        if ch != "\x1b":
            return self.translate_char(ch)

        # Windows 扩展方向键通常是 E0/H 等；Windows Terminal 也可能发送 ANSI Esc 序列。
        # 只在很短窗口内收集序列，超时即认定为独立 Esc，避免编辑状态永久卡住。
        buffer = ch
        deadline = time.monotonic() + 0.08
        while time.monotonic() < deadline:
            if not msvcrt.kbhit():
                time.sleep(0.005)
                continue
            buffer += msvcrt.getwch()
            resolved = self.resolve_escape(buffer)
            if resolved != "unknown":
                return resolved
            if buffer.startswith("\x1b[") and (buffer[-1].isalpha() or buffer[-1] == "~"):
                return "unknown"
            if not buffer.startswith(("\x1b[", "\x1bO")):
                self._pending_console_chars.extend(buffer[1:])
                return "esc"
        self._pending_console_chars.extend(buffer[1:])
        return "esc"

    def stop(self):
        if not self.running:
            return
        self.running = False
        self.output.write(CODES["reset"] + "\x1b[?7h" + CODES["showCursor"] + CODES["leaveAltScreen"])
        self._restore_console_input()
        if hasattr(self.output, "flush"):
            self.output.flush()

    def _prepare_console_input(self):
        """关闭 Windows QuickEdit，避免鼠标拖选暂停控制台，造成窗口/TUI 像卡死。"""
        if os.name != "nt":
            return
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.GetStdHandle(-10)  # STD_INPUT_HANDLE
            mode = ctypes.c_uint32()
            if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                self._old_console_input_mode = (handle, mode.value)
                # ENABLE_EXTENDED_FLAGS=0x0080；ENABLE_QUICK_EDIT_MODE=0x0040
                new_mode = (mode.value | 0x0080) & ~0x0040
                kernel32.SetConsoleMode(handle, new_mode)
        except Exception:
            self._old_console_input_mode = None

    def _restore_console_input(self):
        if not self._old_console_input_mode:
            return
        try:
            import ctypes
            handle, mode = self._old_console_input_mode
            ctypes.windll.kernel32.SetConsoleMode(handle, mode)
        except Exception:
            pass
        finally:
            self._old_console_input_mode = None

    def resolve_escape(self, buf):
        return {"\x1b[A": "up", "\x1b[B": "down", "\x1b[C": "right", "\x1b[D": "left",
                "\x1b[H": "home", "\x1b[F": "end", "\x1b[1~": "home", "\x1b[4~": "end",
                "\x1b[5~": "pgup", "\x1b[6~": "pgdn", "\x1b[3~": "delete"}.get(buf, "unknown")

    @staticmethod
    def _ext_key(ch):
        return {"H": "up", "P": "down", "K": "left", "M": "right", "G": "home",
                "O": "end", "I": "pgup", "Q": "pgdn", "S": "delete"}.get(ch, "unknown")

    @staticmethod
    def translate_char(ch):
        if ch in ("\r", "\n"):
            return "enter"
        if ch == "\x03":
            return "ctrl-c"
        if ch in ("\x7f", "\x08"):
            return "backspace"
        if ch == "\t":
            return "tab"
        if ch == "\x1b":
            return "esc"
        return ch

    def dispatch_key(self, key):
        if not key or key == "unknown":
            return
        if key == "ctrl-c":
            # 直接退出，不再要确认（用户要求）
            self.on_exit_request()
            return
        if self.page and hasattr(self.page, "handle_key"):
            if self.page.handle_key(key, self) is True:
                self.request_render()
                return
        if key in ("left", "right"):
            d = 1 if key == "right" else -1
            self.switch_page((self.current_page_index + d) % len(self.pages))
            return
        if key.isdigit() and 1 <= int(key) <= len(self.pages):
            self.switch_page(int(key) - 1)
            return
        if key == "q":
            self.switch_page(0)

    def request_render(self):
        if self.running:
            self.render()

    def build_menu_bar(self, columns):
        segments = []
        for index, p in enumerate(self.pages):
            label = f" {index + 1}{p.title} "
            segments.append(colorize(label, "reverse") if index == self.current_page_index
                            else colorize(label, "brightBlue"))
        return fit("".join(segments), columns)

    def build_frame(self):
        columns, rows = self.columns, self.rows
        content_height = self.content_height
        clock = format_clock()
        page_title = f"│ {self.page.key}.{self.page.title}" if self.page else ""

        lines = []
        # 标题栏：左侧标题 + 右侧时钟
        lines.append(colorize(fit(f" {self.title}  {page_title}", columns - 10, False), "brightCyan")
                     + colorize(fit(f" {clock}", 10), "gray"))
        # 状态栏（固定 2 行）
        status = self.status_bar_provider(self) or []
        for index in range(2):
            lines.append(status[index] if index < len(status) else fit("", columns))
        # 菜单栏 + 分隔线
        lines.append(self.build_menu_bar(columns))
        lines.append(colorize("─" * columns, "gray"))
        # 内容区
        content = self.page.render(self) if self.page and hasattr(self.page, "render") else []
        for index in range(content_height):
            line = content[index] if index < len(content) else ""
            lines.append(fit(line, columns, False))
        # 版权信息（创作者署名，所有页面统一显示）
        lines.append(colorize(fit("作者：黎路遥 ｜ 微信：luyao2089 ｜ 官网：luyao2089.cc", columns), "gray"))
        lines.append(colorize(fit("版权所有 © 黎路遥，保留所有权利", columns), "gray"))
        # 页脚 + 底边
        footer = self.footer_provider(self)
        if not footer and self.page and hasattr(self.page, "footer"):
            footer = self.page.footer(self) or ""
        lines.append(colorize(fit(footer or "↑↓选择 回车执行 ←→/数字键切页 q返回首页 0首页退出 Ctrl+C直接退出", columns), "gray"))
        lines.append("─" * columns)
        return lines

    def render(self):
        if not self.running:
            return
        cols, rows_now = self.columns, self.rows
        lines = [fit(line, cols, False) for line in self.build_frame()]
        # 终端尺寸变化（拖动/最大化/最小化）时强制全量重绘，避免画面残留/花屏卡死
        need_full = (
            not self.last_frame_lines
            or self.last_cols != cols
            or self.last_rows != rows_now
            or len(self.last_frame_lines) != len(lines)
        )
        self.last_cols, self.last_rows = cols, rows_now
        output = ""
        if need_full:
            output = CODES["cursorHome"] + "\r\n".join(lines)
        else:
            for index in range(len(lines)):
                if lines[index] != (self.last_frame_lines[index] or ""):
                    output += move_to(index + 1, 1) + CODES["reset"] + clear_line() + lines[index]
        self.last_frame_lines = lines
        if output:
            self.output.write(output)
            if hasattr(self.output, "flush"):
                self.output.flush()


# ---------------------------------------------------------------- 任务线程容器
class TaskRunner:
    def __init__(self):
        self.task = None
        self._lock = threading.Lock()

    @property
    def running(self):
        return self.task is not None and not self.task["done"]

    def start(self, desc, fn, args=(), with_progress=False, total=0):
        if self.running:
            return False
        buf = io.StringIO()
        task = {
            "desc": desc, "fn": fn, "args": args, "buf": buf,
            "done": False, "error": None, "result": None,
            "current": 0, "total": int(total or 0), "stage": "准备中",
            "detail": "任务已创建", "started_at": time.monotonic(),
        }
        self.task = task

        def report_progress(current=0, total=0, stage="运行中", detail=""):
            # 业务层只上报事实，TUI 决定如何显示进度条/动画。
            with self._lock:
                if self.task is not task:
                    return
                task["current"] = int(current or 0)
                if total:
                    task["total"] = int(total)
                task["stage"] = str(stage or "运行中")
                task["detail"] = str(detail or "")
                task["updated_at"] = time.monotonic()

        def worker():
            try:
                with contextlib.redirect_stdout(buf):
                    if with_progress:
                        task["result"] = fn(*args, progress=report_progress)
                    else:
                        task["result"] = fn(*args)
            except Exception as exc:  # noqa: BLE001
                task["error"] = exc
            finally:
                task["done"] = True
                task["updated_at"] = time.monotonic()
                task["finished_at"] = time.time()

        threading.Thread(target=worker, daemon=True).start()
        return True

    def snapshot_lines(self, max_lines=200):
        if not self.task:
            return []
        tail = self.task["buf"].getvalue().splitlines()[-max_lines:]
        return tail

    def finish(self):
        t = self.task
        self.task = None
        return t


def has_saved_profile():
    """只提示专用 Profile 是否已创建；不得据此宣称登录态有效。"""
    if not os.path.isdir(biz.PROFILE_DIR):
        return False
    cookie_paths = (
        os.path.join(biz.PROFILE_DIR, "Default", "Network", "Cookies"),  # Edge 127+
        os.path.join(biz.PROFILE_DIR, "Default", "Cookies"),              # 旧版 Edge
    )
    return any(os.path.exists(path) for path in cookie_paths)


# ---------------------------------------------------------------- 页面：首页（主菜单）
class OverviewPage:
    key, title = "1", "首页"

    def __init__(self, ctx):
        self.ctx = ctx
        self.state = {"selection": 0, "message": ""}

    @property
    def items(self):
        login_item = ("首次登录 / 检查登录态", "已登录则直接复用，未登录才打开登录页面")
        common_items = [
            ("开始抓取", "按配置页参数启动职位采集"),
            ("配置采集参数", "编辑关键词、城市、页数和导出格式"),
            ('采集京东公开主体', '导出自营经营主体、区域与证照来源'),
            ('采集供应商网店铺主体', '读取程序旁店铺清单，导出B2B商家企业'),
            ("打开结果目录", "用资源管理器打开输出文件夹"),
            ("退出采集工具", "结束本程序；首页按 0 可直接退出"),
        ]
        # 未登录时把首次登录置顶；已登录时沉底，避免首页每次都先看到低频操作。
        return [login_item, *common_items] if not has_saved_profile() else [*common_items, login_item]

    def on_enter(self, app):
        self.state["selection"] = min(self.state["selection"], len(self.items) - 1)

    def render(self, app):
        columns = app.columns
        lines = [colorize(fit("主操作（↑↓选择 回车执行 ←→切页 0退出）", columns), "brightBlue"), ""]
        for index, (label, desc) in enumerate(self.items):
            if len(lines) >= app.content_height - 1:
                break
            selected = index == self.state["selection"]
            prefix = "▶ " if selected else "  "
            if label == "开始抓取":
                label = colorize(label, "brightGreen")
            elif label == "退出采集工具":
                label = colorize(label, "brightRed")
            line = f"{prefix}{label}　{colorize(desc, 'gray')}"
            lines.append(colorize(fit(line, columns), "reverse") if selected else fit(line, columns))
        if self.state["message"]:
            lines.append("")
            lines.append(colorize(fit(f"提示：{self.state['message']}", columns), "brightYellow"))
        return lines

    def handle_key(self, key, app):
        items = self.items
        if key == "0":
            # 首页数字 0 作为退出快捷键，和退出菜单的回车操作一致。
            app.on_exit_request()
        elif key == "up":
            self.state["selection"] = (self.state["selection"] - 1) % len(items)
        elif key == "down":
            self.state["selection"] = (self.state["selection"] + 1) % len(items)
        elif key == "enter":
            action_label = items[self.state["selection"]][0]
            if action_label == "首次登录 / 检查登录态":
                ok = self.ctx.tasks.start(
                    "启动专用浏览器并等待登录",
                    self.ctx.action_login,
                    with_progress=True,
                )
                if ok:
                    app.switch_page(2)  # 切到日志页看进度
            elif action_label == "开始抓取":
                if not self.ctx.start_fetch(app):
                    self.state["message"] = "已有任务在运行，请先等待完成"
            elif action_label == "配置采集参数":
                app.switch_page(1)
            elif action_label == '采集京东公开主体':
                if self.ctx.tasks.start('采集京东公开自营经营主体', merchant_subjects.run_subjects,
                                        (self.ctx.config['format'],), with_progress=True, total=1):
                    app.switch_page(2)
                else:
                    self.state['message'] = '已有任务在运行，请先等待完成'
            elif action_label == '采集供应商网店铺主体':
                if self.ctx.tasks.start('采集供应商网B2B店铺主体', shop_subjects.run_shops,
                                        (self.ctx.config['format'],), with_progress=True):
                    app.switch_page(2)
                else:
                    self.state['message'] = '已有任务在运行，请先等待完成'
            elif action_label == "打开结果目录":
                self.open_result_dir()
            elif action_label == "退出采集工具":
                # 退出选项：直接退出，不再要确认（用户要求）
                app.on_exit_request()
        else:
            return None
        return True

    @staticmethod
    def open_result_dir():
        os.makedirs(biz.RESULT_DIR, exist_ok=True)
        subprocess.Popen(["explorer", biz.RESULT_DIR])
# ---------------------------------------------------------------- 页面：配置（只维护采集参数，抓取动作位于首页）
class ConfigPage:
    key, title = "2", "配置"

    def __init__(self, ctx):
        self.ctx = ctx
        self.state = {"selection": 0, "editing": None, "edit_buffer": "", "message": ""}

    @property
    def fields(self):
        return [
            {"key": "keyword", "label": "搜索词", "type": "text"},
            {"key": "city", "label": "城市", "type": "text"},
            {"key": "pages", "label": "页数", "type": "number"},
            {"key": "format", "label": "格式", "type": "choice", "choices": ["csv", "json", "both"]},
            {'key': 'title_filter', 'label': '岗位包含词', 'type': 'text'},
        ]

    def on_enter(self, app):
        self.state["editing"] = None
        self.state["message"] = ""

    def render(self, app):
        columns = app.columns
        label_width = 12
        lines = [colorize(fit(f"采集配置（↑↓选择 回车编辑；编辑中 ←→调整 Esc取消 回车保存 r重置 q返回首页）", columns), "brightBlue"), ""]
        for index, field in enumerate(self.fields):
            selected = index == self.state["selection"]
            prefix = "▶ " if selected else "  "
            is_editing_field = self.state["editing"] and self.state["editing"]["key"] == field["key"]
            shown_value = self.state["edit_buffer"] if is_editing_field else self.ctx.config[field["key"]]
            if field['key'] == 'title_filter' and not shown_value and not is_editing_field:
                shown_value = '不限（可填客服,仓管等）'
            if field["type"] == "choice":
                value = f"{shown_value} (←→切换)" if is_editing_field else shown_value
            elif field["type"] == "number":
                value = f"{shown_value} (←→调整)" if is_editing_field else shown_value
            else:
                value = shown_value
            line = f"{prefix}{pad_end(field['label'], label_width)} {value}"
            lines.append(colorize(fit(line, columns), "reverse") if selected else fit(line, columns))
        if self.state["editing"]:
            lines.append("")
            lines.append(colorize(fit(f"编辑【{self.state['editing']['label']}】：{self.state['edit_buffer']}_", columns), "brightCyan"))
            lines.append(colorize("回车确认 Esc取消", "gray"))
        elif self.state["message"]:
            lines.append("")
            lines.append(colorize(fit(f"提示：{self.state['message']}", columns), "brightYellow"))
        return lines

    def handle_key(self, key, app):
        if self.state["editing"]:
            return self._handle_editing(key, app)
        fields = self.fields
        if key == "up":
            self.state["selection"] = (self.state["selection"] - 1) % len(fields)
        elif key == "down":
            self.state["selection"] = (self.state["selection"] + 1) % len(fields)
        elif key in ("left", "right"):
            # 所有配置必须先按回车进入编辑；未编辑时左右键不改值，交给全局逻辑切页。
            return None
        elif key == "enter":
            self._begin_edit(fields[self.state["selection"]])
        elif key == "r":
            self.ctx.config.update(keyword="国内电商", city="深圳", pages=1, format="csv", title_filter='')
            self.state["message"] = "参数已恢复默认"
        else:
            return None
        return True

    def _handle_editing(self, key, app):
        field = self.state["editing"]
        if key == "enter":
            value = self.state["edit_buffer"].strip()
            if field["type"] == "text":
                if value or field['key'] == 'title_filter':
                    self.ctx.config[field["key"]] = value
                else:
                    self.state["message"] = f"{field['label']}不能为空"
            elif field["type"] == "number":
                try:
                    self.ctx.config[field["key"]] = biz.normalize_page_count(value)
                except ValueError:
                    self.state["message"] = f"页数必须是 1-{biz.MAX_PAGES} 的整数"
            elif field["type"] == "choice":
                if value in field["choices"]:
                    self.ctx.config[field["key"]] = value
                else:
                    self.state["message"] = "格式只能是 csv、json 或 both"
            self.state["editing"] = None
        elif key == "esc":
            # 编辑期间只改缓冲区；取消时无需回写，原配置保持不变。
            self.state["editing"] = None
            self.state["edit_buffer"] = ""
        elif key in ("left", "right"):
            d = 1 if key == "right" else -1
            if field["type"] == "number":
                try:
                    current = int(self.state["edit_buffer"])
                except ValueError:
                    current = int(self.ctx.config[field["key"]])
                self.state["edit_buffer"] = str(max(1, min(biz.MAX_PAGES, current + d)))
            elif field["type"] == "choice":
                choices = field["choices"]
                current = self.state["edit_buffer"]
                if current not in choices:
                    current = self.ctx.config[field["key"]]
                self.state["edit_buffer"] = choices[(choices.index(current) + d) % len(choices)]
            # 文本编辑也消费左右键，但不移动/切页，避免误操作离开编辑状态。
        elif key == "backspace":
            self.state["edit_buffer"] = self.state["edit_buffer"][:-1]
        elif field["type"] == "text" and len(key) == 1 and key.isprintable():
            self.state["edit_buffer"] += key
        elif field["type"] == "number" and len(key) == 1 and key.isdigit():
            self.state["edit_buffer"] += key
        else:
            return None
        return True

    def _begin_edit(self, field):
        self.state["editing"] = field
        self.state["edit_buffer"] = str(self.ctx.config[field["key"]])


# ---------------------------------------------------------------- 页面：运行日志
class LogPage:
    key, title = "3", "日志"

    def __init__(self, ctx):
        self.ctx = ctx

    def render(self, app):
        columns = app.columns
        tasks = self.ctx.tasks
        lines = [colorize(fit("运行日志（最近一次任务输出）", columns), "brightBlue")]
        if not tasks.task:
            lines.append(colorize(fit("还没有运行过任务，请回首页选择【开始抓取】。", columns), "gray"))
            return lines
        if tasks.running:
            task = tasks.task
            elapsed = format_elapsed(time.monotonic() - task.get("started_at", time.monotonic()))
            progress = format_progress_bar(task.get("current"), task.get("total"))
            lines.append(colorize(fit(f"{spinner_frame()} 运行中：{task['stage']}  {progress}  已运行 {elapsed}", columns), "brightYellow"))
            if task.get("detail"):
                lines.append(colorize(fit(f"  详情：{task['detail']}", columns), "gray"))
        else:
            t = tasks.task
            if t["error"]:
                summary = f"✗ 任务失败：{t['desc']} → {t['error']}"
                summary_color = "brightRed"
            else:
                result = t["result"]
                partial = str(t.get("stage", "")) == "部分完成"
                if isinstance(result, list) and partial:
                    finished_at = time.strftime(
                        "%Y-%m-%d %H:%M:%S",
                        time.localtime(t.get("finished_at", time.time())),
                    )
                    summary = f"⚠ 部分完成：{t['desc']} → 共 {len(result)} 条，完成时间：{finished_at}"
                    summary_color = "brightYellow"
                elif isinstance(result, list):
                    finished_at = time.strftime(
                        "%Y-%m-%d %H:%M:%S",
                        time.localtime(t.get("finished_at", time.time())),
                    )
                    summary = f"🎉 已完成：{t['desc']} → 共 {len(result)} 条，完成时间：{finished_at}，已导出到 {biz.RESULT_DIR}"
                    summary_color = "brightGreen"
                elif result is True:
                    summary = f"✓ 已完成：{t['desc']} → 登录成功，登录态已保存"
                    summary_color = "brightGreen"
                else:
                    summary = f"✓ 已完成：{t['desc']} → 结果：{result}"
                    summary_color = "brightGreen"
            lines.append(colorize(fit(summary, columns), summary_color))
        lines.append("")
        # 缓冲输出尾部
        tail = tasks.snapshot_lines(app.content_height - 3)
        for line in tail:
            lines.append(fit(line, columns))
        return lines

    def handle_key(self, key, app):
        return None  # 纯展示页，按键走全局（左右切页/数字键）


# ---------------------------------------------------------------- 页面：最近结果
class ResultsPage:
    key, title = "4", "结果"

    def __init__(self, ctx):
        self.ctx = ctx

    def list_files(self):
        os.makedirs(biz.RESULT_DIR, exist_ok=True)
        files = glob.glob(os.path.join(biz.RESULT_DIR, "boss_jobs_*")) + glob.glob(os.path.join(biz.RESULT_DIR, 'merchant_subjects_*'))
        files.sort(key=os.path.getmtime, reverse=True)
        return files[:20]

    def render(self, app):
        columns = app.columns
        lines = [colorize(fit("最近结果（回车打开所在目录）", columns), "brightBlue"), ""]
        files = self.list_files()
        if not files:
            lines.append(colorize(fit("结果目录还没有文件，请回首页选择【开始抓取】。", columns), "gray"))
            return lines
        for path in files:
            if len(lines) >= app.content_height - 1:
                break
            name = os.path.basename(path)
            size = os.path.getsize(path)
            when = time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(path)))
            lines.append(fit(f"  {name}  {size}B  {when}", columns))
        lines.append("")
        lines.append(colorize(f"输出目录：{biz.RESULT_DIR}", "gray"))
        return lines

    def handle_key(self, key, app):
        if key == "enter":
            os.makedirs(biz.RESULT_DIR, exist_ok=True)
            subprocess.Popen(["explorer", biz.RESULT_DIR])
            return True
        return None


# ---------------------------------------------------------------- 组装与启动
class Ctx:
    def __init__(self):
        self.tasks = TaskRunner()
        self.config = {"keyword": "国内电商", "city": "深圳", "pages": 1, "format": "csv", 'title_filter': ''}
        self._cleaned_up = False

    @staticmethod
    def action_login(timeout=900, progress=None):
        if callable(progress):
            progress(0, 0, "连接专用浏览器", "正在建立登录会话")
        active_port = biz.ensure_edge_running(biz.DEFAULT_PORT)
        ok = biz.login_wait(
            "内贸", biz.CITY_CODES.get("深圳", "深圳"), active_port, timeout,
            progress=progress,
        )
        if callable(progress):
            progress(1 if ok else 0, 1, "登录完成" if ok else "登录未完成", "登录态已保存" if ok else "请检查 Edge 页面")
        return bool(ok)

    def start_fetch(self, app):
        """首页唯一的抓取入口，统一读取配置页参数并切换到日志页。"""
        if self.tasks.running:
            return False
        config = self.config
        args = (config["keyword"], config["city"], config["pages"], config["format"], 3, biz.DEFAULT_PORT)
        ok = self.tasks.start(
            f"抓取 {config['keyword']} @ {config['city']}",
            lambda *args, progress=None: biz.run_fetch(*args, progress=progress, title_filter=config['title_filter']),
            args,
            with_progress=True,
            total=config["pages"],
        )
        if ok:
            app.switch_page(2)
        return ok

    def cleanup(self):
        """退出时只关闭本次 TUI 启动的专用浏览器，不关闭外部已有实例。"""
        if self._cleaned_up:
            return
        self._cleaned_up = True
        biz.close_owned_edge()


def build_status_lines(ctx, app):
    profile_ready = has_saved_profile()
    login = "已有Profile(登录以接口为准)" if profile_ready else "未建立Profile(首次需扫码)"
    task = ctx.tasks.task
    if task and not task["done"]:
        elapsed = format_elapsed(time.monotonic() - task.get("started_at", time.monotonic()))
        task_text = (
            f"任务 [{colorize('运行中', 'brightYellow')}] {task['desc']} "
            f"{spinner_frame()} {format_progress_bar(task.get('current'), task.get('total'), 12)} "
            f"{elapsed}"
        )
    else:
        task_text = "任务 [空闲] 等待操作"
    lines = [fit(f" {task_text}   登录资料 [{colorize(login, 'brightCyan' if profile_ready else 'brightRed')}]", app.columns)]
    lines.append(fit(" 提示：登录只做一次，之后无需重复；抓取默认低频(3秒/页)防封。", app.columns))
    return lines


def ensure_console_utf8():
    """无论以何种方式启动，都把控制台输入/输出代码页切成 UTF-8，避免中文乱码。"""
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    except Exception:
        pass


def main(argv=None):
    ensure_console_utf8()
    argv = argv if argv is not None else sys.argv[1:]
    # 无头自动化入口：AI/脚本无需按键即可真实运行业务（SoftTalk #2705）
    if argv and argv[0] == "--auto":
        import argparse as _ap
        ap = _ap.ArgumentParser(description="无头自动化运行真实业务")
        ap.add_argument("--auto", choices=["login", "fetch", 'subjects', 'shops'], help="login=登录 fetch=招聘 subjects=京东公开主体 shops=供应商网店铺主体")
        ap.add_argument('--shops-file', default=None, help='供应商网店铺清单路径')
        ap.add_argument("--keyword", default="国内电商")
        ap.add_argument('--title-filter', default='')
        ap.add_argument("--city", default="深圳")
        ap.add_argument("--pages", type=int, default=1)
        ap.add_argument("--format", choices=["csv", "json", "both"], default="csv")
        ap.add_argument("--login-timeout", type=int, default=900)
        args = ap.parse_args(argv)
        try:
            if args.auto == 'shops':
                shop_subjects.run_shops(args.format, input_path=args.shops_file)
                return
            if args.auto == 'subjects':
                merchant_subjects.run_subjects(args.format)
                return
            if args.auto == "login":
                ok = Ctx.action_login(timeout=args.login_timeout)
                sys.exit(0 if ok else 2)
            biz.run_fetch(args.keyword, args.city, args.pages, args.format, delay=3, port=biz.DEFAULT_PORT, title_filter=args.title_filter)
            sys.exit(0)
        finally:
            # 自动化入口也遵守同一套浏览器所有权清理规则。
            biz.close_owned_edge()

    ctx = Ctx()
    pages = [
        OverviewPage(ctx),
        ConfigPage(ctx),
        LogPage(ctx),
        ResultsPage(ctx),
    ]
    def request_exit():
        # 先退出 TUI，再按归属清理本次启动的浏览器进程树。
        app.stop()
        ctx.cleanup()

    app = TuiApp(
        title=f"BOSS直聘采集工具 {APP_VERSION}",
        pages=pages,
        on_exit_request=request_exit,
        status_bar_provider=lambda a: build_status_lines(ctx, a),
    )
    try:
        app.start()
    finally:
        # Ctrl+C、窗口关闭、非 TTY 返回等路径都必须执行同一份清理。
        app.stop()
        ctx.cleanup()
    sys.exit(0)


if __name__ == "__main__":
    main()
