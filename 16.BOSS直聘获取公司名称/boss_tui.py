#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
boss_tui.py —— BOSS直聘采集工具 终端图形界面（参考 1.客服超时督办 的 TUI 交互）
  交互：↑↓ 选择 / ←→ 切页 / 回车执行 / 数字键切页 / Ctrl+C 退出确认
  布局：标题栏+时钟 / 状态栏 / 菜单栏 / 分隔线 / 内容区 / 版权 / 页脚 / 底边
  业务真源：直接 import boss_cdp（登录、抓取、导出全走同一份业务代码）
  运行：python boss_tui.py   （仅 Windows 控制台，纯标准库，无第三方依赖）
"""

import contextlib
import glob
import io
import os
import subprocess
import sys
import threading
import time
import unicodedata

import boss_cdp as biz  # 业务真源（BOSS 采集核心）

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
        self.exit_confirm_pending = False
        self.last_frame_lines = None
        self.escape_buffer = ""

    @property
    def page(self):
        return self.pages[self.current_page_index] if self.pages else None

    @property
    def columns(self):
        return max(48, self.output.columns if hasattr(self.output, "columns") and self.output.columns else 80)

    @property
    def rows(self):
        return max(14, self.output.rows if hasattr(self.output, "rows") and self.output.rows else 24)

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
        self.output.write(CODES["enterAltScreen"] + CODES["clearScreen"] + CODES["hideCursor"] + "\x1b[?7l")
        import msvcrt
        while self.running:
            if not msvcrt.kbhit():
                time.sleep(0.25)
                self.request_render()
                continue
            ch = msvcrt.getwch()
            if self.escape_buffer or ch == "\x1b":
                # 等待完整转义序列（方向键等）
                self.escape_buffer += ch
                if self.escape_buffer.startswith("\x1b[") and self.escape_buffer in (
                        "\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D", "\x1b[H", "\x1b[F",
                        "\x1b[1~", "\x1b[4~", "\x1b[5~", "\x1b[6~", "\x1b[3~"):
                    key = self.resolve_escape(self.escape_buffer)
                    self.escape_buffer = ""
                    self.dispatch_key(key)
                elif len(self.escape_buffer) > 8:
                    self.escape_buffer = ""
                continue
            if ch == "\xe0" or ch == "\x00":
                # 扩展键：方向键等（第二字节）
                ch2 = msvcrt.getwch()
                self.dispatch_key(self._ext_key(ch2))
                continue
            key = self.translate_char(ch)
            if key:
                self.dispatch_key(key)

    @staticmethod
    def _interactive_terminal():
        try:
            return bool(sys.stdin.isatty()) and bool(sys.stdout.isatty())
        except Exception:
            return False

    def stop(self):
        if not self.running:
            return
        self.running = False
        self.output.write(CODES["reset"] + "\x1b[?7h" + CODES["showCursor"] + CODES["leaveAltScreen"])
        if hasattr(self.output, "flush"):
            self.output.flush()

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
        if self.exit_confirm_pending:
            if key in ("y", "Y", "enter"):
                self.exit_confirm_pending = False
                self.on_exit_request()
            elif key in ("n", "N", "esc", "ctrl-c"):
                self.exit_confirm_pending = False
                self.request_render()
            return
        if key == "ctrl-c":
            self.exit_confirm_pending = True
            self.request_render()
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
        if self.exit_confirm_pending:
            content = self.build_exit_confirm_overlay(content, columns, content_height)
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
        lines.append(colorize(fit(footer or "↑↓选择 回车执行 ←→/数字键切页 q返回总览 Ctrl+C退出", columns), "gray"))
        lines.append("─" * columns)
        return lines

    def build_exit_confirm_overlay(self, content, columns, content_height):
        question = "确认退出采集工具？后台任务将一并停止 (y=退出 n=取消)"
        out = content[: max(0, content_height - 3)]
        out.append("")
        out.append(colorize(fit("─" * min(columns, 56), columns), "yellow"))
        out.append(colorize(fit(f" {question}", columns), "brightYellow"))
        return out

    def render(self):
        if not self.running:
            return
        lines = [fit(line, self.columns, False) for line in self.build_frame()]
        need_full = not self.last_frame_lines or len(self.last_frame_lines) != len(lines)
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

    @property
    def running(self):
        return self.task is not None and not self.task["done"]

    def start(self, desc, fn, args=()):
        if self.running:
            return False
        buf = io.StringIO()
        self.task = {"desc": desc, "fn": fn, "args": args, "buf": buf,
                     "done": False, "error": None, "result": None}

        def worker():
            try:
                with contextlib.redirect_stdout(buf):
                    self.task["result"] = fn(*args)
            except Exception as exc:  # noqa: BLE001
                self.task["error"] = exc
            finally:
                self.task["done"] = True

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


def is_logged_in():
    """专用 profile 存在即视为已登录（登录态持久化在该目录）。"""
    return os.path.isdir(biz.PROFILE_DIR) and os.path.exists(
        os.path.join(biz.PROFILE_DIR, "Default", "Cookies"))


# ---------------------------------------------------------------- 页面：总览（主菜单）
class OverviewPage:
    key, title = "1", "总览"

    def __init__(self, ctx):
        self.ctx = ctx
        self.state = {"selection": 0, "message": ""}

    @property
    def items(self):
        return [
            ("启动Chrome并登录", "首次需要扫码，登录态永久保存，之后不再登录"),
            ("抓取职位数据", "设置关键词/城市/页数并开始抓取"),
            ("打开结果目录", "用资源管理器打开输出文件夹"),
            ("退出采集工具", "结束本程序"),
        ]

    def on_enter(self, app):
        self.state["selection"] = min(self.state["selection"], len(self.items) - 1)

    def render(self, app):
        columns = app.columns
        lines = [colorize(fit("主操作（↑↓选择 回车执行 ←→切页）", columns), "brightBlue"), ""]
        for index, (label, desc) in enumerate(self.items):
            if len(lines) >= app.content_height - 1:
                break
            selected = index == self.state["selection"]
            prefix = "▶ " if selected else "  "
            line = f"{prefix}{label}　{colorize(desc, 'gray')}"
            lines.append(colorize(fit(line, columns), "reverse") if selected else fit(line, columns))
        if self.state["message"]:
            lines.append("")
            lines.append(colorize(fit(f"提示：{self.state['message']}", columns), "brightYellow"))
        return lines

    def handle_key(self, key, app):
        items = self.items
        if key == "up":
            self.state["selection"] = (self.state["selection"] - 1) % len(items)
        elif key == "down":
            self.state["selection"] = (self.state["selection"] + 1) % len(items)
        elif key == "enter":
            action = self.state["selection"]
            if action == 0:
                ok = self.ctx.tasks.start("启动专用Chrome并等待登录",
                                          self.ctx.action_login)
                if ok:
                    app.switch_page(2)  # 切到日志页看进度
            elif action == 1:
                app.switch_page(1)
            elif action == 2:
                self.open_result_dir()
            elif action == 3:
                app.exit_confirm_pending = True
                app.request_render()
        else:
            return None
        return True

    @staticmethod
    def open_result_dir():
        os.makedirs(biz.RESULT_DIR, exist_ok=True)
        subprocess.Popen(["explorer", biz.RESULT_DIR])


# ---------------------------------------------------------------- 页面：抓取设置（表单编辑，对齐 1 号 config 页）
class FetchPage:
    key, title = "2", "抓取"

    def __init__(self, ctx):
        self.ctx = ctx
        self.state = {"selection": 0, "editing": None, "edit_buffer": "",
                      "keyword": "国内电商", "city": "深圳", "pages": 1, "format": "csv", "message": ""}

    @property
    def fields(self):
        return [
            {"key": "keyword", "label": "关键词", "type": "text"},
            {"key": "city", "label": "城市", "type": "text"},
            {"key": "pages", "label": "页数", "type": "number"},
            {"key": "format", "label": "格式", "type": "choice", "choices": ["csv", "json", "both"]},
            {"key": "run", "label": "开始抓取", "type": "action"},
        ]

    def on_enter(self, app):
        self.state["editing"] = None
        self.state["message"] = ""

    def render(self, app):
        columns = app.columns
        label_width = 12
        lines = [colorize(fit(f"抓取设置（↑↓选择 回车编辑/执行 ←→修改值 s开始 r重置）", columns), "brightBlue"), ""]
        for index, field in enumerate(self.fields):
            if len(lines) >= app.content_height - 3 and self.state["editing"] is None:
                break
            selected = index == self.state["selection"]
            prefix = "▶ " if selected else "  "
            if field["type"] == "action":
                value_text = "回车开始抓取"
                value = colorize(value_text, "brightGreen") if selected else value_text
            elif field["type"] == "choice":
                value = f"{self.state[field['key']]} (←→切换)"
            elif field["type"] == "number":
                value = f"{self.state[field['key']]} (←→调)"
            else:
                value = self.state[field["key"]]
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
            field = fields[self.state["selection"]]
            d = 1 if key == "right" else -1
            if field["type"] == "number":
                self.state["pages"] = max(1, min(10, self.state["pages"] + d))
            elif field["type"] == "choice":
                choices = field["choices"]
                self.state["format"] = choices[(choices.index(self.state["format"]) + d) % len(choices)]
            elif field["type"] == "text":
                self._begin_edit(field)
            # action 行：消费键避免误切页
        elif key == "enter":
            field = fields[self.state["selection"]]
            if field["type"] == "action":
                return self._start_fetch(app)
            self.state["editing"] = field
            self.state["edit_buffer"] = str(self.state[field["key"]])
            self.state["selection"] = min(self.state["selection"], len(fields) - 1)
        elif key == "s":
            self._start_fetch(app)
        elif key == "r":
            self.state.update(keyword="国内电商", city="深圳", pages=1, format="csv")
            self.state["message"] = "参数已恢复默认"
        else:
            return None
        return True

    def _handle_editing(self, key, app):
        field = self.state["editing"]
        if key == "enter":
            value = self.state["edit_buffer"].strip()
            if value:
                self.state[field["key"]] = value
            if field["type"] == "text" and not value:
                self.state["message"] = f"{field['label']}不能为空"
            self.state["editing"] = None
        elif key == "esc":
            self.state["editing"] = None
        elif key == "backspace":
            self.state["edit_buffer"] = self.state["edit_buffer"][:-1]
        elif len(key) == 1 and key.isprintable():
            self.state["edit_buffer"] += key
        else:
            return None
        return True

    def _begin_edit(self, field):
        self.state["editing"] = field
        self.state["edit_buffer"] = str(self.state[field["key"]])

    def _start_fetch(self, app):
        if self.ctx.tasks.running:
            self.state["message"] = "已有任务在运行，请先等待完成"
            return True
        kwargs = dict(keyword=self.state["keyword"], city=self.state["city"],
                      pages=self.state["pages"], fmt=self.state["format"], delay=3, port=biz.DEFAULT_PORT)
        ok = self.ctx.tasks.start(f"抓取 {self.state['keyword']} @ {self.state['city']}",
                                  biz.run_fetch, tuple(kwargs.values()))
        self.state["message"] = "" if ok else "启动失败：已有任务在运行"
        if ok:
            app.switch_page(2)  # 去日志页看进度
        return True


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
            lines.append(colorize(fit("还没有运行过任务，去【2抓取】页开始吧。", columns), "gray"))
            return lines
        if tasks.running:
            lines.append(colorize(fit(f"▶ 运行中：{tasks.task['desc']}（完成后自动显示结果，Ctrl+C 可退出）", columns), "brightYellow"))
        else:
            t = tasks.task
            if t["error"]:
                summary = f"✗ 已完成：{t['desc']} → 失败：{t['error']}"
            else:
                result = t["result"]
                if isinstance(result, list):
                    summary = f"✓ 已完成：{t['desc']} → 共 {len(result)} 条，已导出到 {biz.RESULT_DIR}"
                elif result is True:
                    summary = f"✓ 已完成：{t['desc']} → 登录成功，登录态已保存"
                else:
                    summary = f"✓ 已完成：{t['desc']} → 结果：{result}"
            lines.append(colorize(fit(summary, columns), "brightGreen" if not t["error"] else "brightRed"))
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
        files = glob.glob(os.path.join(biz.RESULT_DIR, "boss_jobs_*"))
        files.sort(key=os.path.getmtime, reverse=True)
        return files[:20]

    def render(self, app):
        columns = app.columns
        lines = [colorize(fit("最近结果（回车打开所在目录）", columns), "brightBlue"), ""]
        files = self.list_files()
        if not files:
            lines.append(colorize(fit("结果目录还没有文件，去【2抓取】页运行一次。", columns), "gray"))
            return lines
        for path in files:
            if len(lines) >= app.content_height - 1:
                break
            name = os.path.basename(path)
            size = os.path.getsize(path)
            when = time.strftime("%m-%d %H:%M", time.localtime(os.path.getmtime(path)))
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

    @staticmethod
    def action_login():
        biz.ensure_chrome_running(biz.DEFAULT_PORT)
        ok = biz.login_wait("内贸", biz.CITY_CODES.get("深圳", "深圳"), biz.DEFAULT_PORT, 900)
        return bool(ok)


def build_status_lines(ctx, app):
    login = "已登录(Profile)" if is_logged_in() else "未登录(首次需扫码)"
    task = ctx.tasks.task
    if task and not task["done"]:
        task_text = f"任务 [{colorize('运行中', 'brightYellow')}] {task['desc']}"
    else:
        task_text = "任务 [空闲] 等待操作"
    lines = [fit(f" {task_text}   登录 [{colorize(login, 'brightGreen' if is_logged_in() else 'brightRed')}]", app.columns)]
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


def main():
    ensure_console_utf8()
    ctx = Ctx()
    pages = [
        OverviewPage(ctx),
        FetchPage(ctx),
        LogPage(ctx),
        ResultsPage(ctx),
    ]
    app = TuiApp(
        title="BOSS直聘采集工具",
        pages=pages,
        on_exit_request=lambda: app.stop(),
        status_bar_provider=lambda a: build_status_lines(ctx, a),
    )
    app.start()
    # 退出时停止渲染循环并清理终端（TuiApp.start 内部循环结束后执行到这里）
    sys.exit(0)


if __name__ == "__main__":
    main()