"""终端布局与按键循环，与网站业务、任务线程分离。"""
import os
import re
import shutil
import sys
import time
import unicodedata

ESC = "\x1b"
CODES = {name: f"{ESC}[{code}m" for name, code in {
    "reset": 0, "bold": 1, "dim": 2, "underline": 4, "reverse": 7,
    "black": 30, "red": 31, "green": 32, "yellow": 33, "blue": 34,
    "magenta": 35, "cyan": 36, "white": 37, "gray": 90, "brightRed": 91,
    "brightGreen": 92, "brightYellow": 93, "brightBlue": 94, "brightCyan": 96,
    "bgRed": 41, "bgGreen": 42, "bgYellow": 43}.items()}
CODES.update(hideCursor=f"{ESC}[?25l", showCursor=f"{ESC}[?25h", enterAltScreen=f"{ESC}[?1049h",
             leaveAltScreen=f"{ESC}[?1049l", clearScreen=f"{ESC}[2J", cursorHome=f"{ESC}[H")
ANSI_PATTERN = r"\x1b\[[0-9;]*[A-Za-z]"
ANSI_TOKEN_PATTERN = r"^\x1b\[[0-9;]*[A-Za-z]$"
ANSI_PART_PATTERN = r"(\x1b\[[0-9;]*[A-Za-z])"
WIDE_RANGES = [(0x1100, 0x115F), (0x2E80, 0x303E), (0x3041, 0x33FF), (0x3400, 0x4DBF),
               (0x4E00, 0x9FFF), (0xA000, 0xA4CF), (0xAC00, 0xD7A3), (0xF900, 0xFAFF),
               (0xFE30, 0xFE4F), (0xFF00, 0xFF60), (0xFFE0, 0xFFE6), (0x1F300, 0x1FAFF)]


def is_wide_char(ch):
    return any(lo <= ord(ch) <= hi for lo, hi in WIDE_RANGES)


def _is_zero_width(ch):
    return unicodedata.category(ch) in ("Mn", "Me", "Cf")


def display_width(text):
    return sum(0 if _is_zero_width(ch) else (2 if is_wide_char(ch) else 1)
               for ch in re.sub(ANSI_PATTERN, "", str(text)))


def colorize(text, color):
    return f"{CODES[color]}{text}{CODES['reset']}" if color in CODES else str(text)


def pad_end(text, width, fill=" "):
    return str(text) + fill * max(0, width - display_width(text))


def pad_start(text, width, fill=" "):
    return fill * max(0, width - display_width(text)) + str(text)


def truncate(text, width):
    text = str(text)
    if width <= 0:
        return ""
    if display_width(text) <= width:
        return text
    result, used, had_escape = "", 0, False
    for part in re.split(ANSI_PART_PATTERN, text):
        if re.match(ANSI_TOKEN_PATTERN, part):
            result += part
            had_escape = True
            continue
        for ch in part:
            size = 0 if _is_zero_width(ch) else (2 if is_wide_char(ch) else 1)
            if used + size > width - 1:
                return result + (CODES["reset"] if had_escape else "") + "…"
            result += ch
            used += size
    return result


def fit(text, width, allow_truncate=True):
    text = truncate(text, width) if allow_truncate else str(text)
    return pad_end(text, width)


def move_to(row, col):
    return f"{ESC}[{row};{col}H"


def clear_line():
    return f"{ESC}[2K"


def format_clock():
    return time.strftime("%H:%M:%S")


def spinner_frame(rate=4.0):
    frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    return frames[int(time.monotonic() * rate) % len(frames)]


def format_progress_bar(current, total, width=24):
    width = max(8, int(width))
    total, current = int(total or 0), max(0, int(current or 0))
    if total <= 0:
        cells = ["░"] * width
        cells[int(time.monotonic() * 4) % width] = "▰"
        return f"[{''.join(cells)}]  --%"
    current = min(current, total)
    filled = round(current / total * width)
    return f"[{'▰' * filled}{'▱' * (width - filled)}]  {round(current / total * 100):>3}%"


def format_elapsed(seconds):
    minutes, seconds = divmod(max(0, int(seconds or 0)), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}时{minutes:02d}分{seconds:02d}秒"
    return f"{minutes}分{seconds:02d}秒" if minutes else f"{seconds}秒"


def safe_log_text(text):
    # 日志可能含有网站提供的文本，不能把其中的终端控制序列执行出来。
    text = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", str(text))
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    return "".join(ch for ch in text if ch.isprintable() or ch == "\t").replace("\t", "    ")


class TuiApp:
    def __init__(self, title, pages, output=None, on_exit_request=None, status_bar_provider=None,
                 footer_provider=None, on_tick=None):
        self.title, self.pages = title, pages
        self.current_page_index = 0
        self.output = output if output is not None else sys.stdout
        self.on_exit_request = on_exit_request or (lambda: None)
        self.status_bar_provider = status_bar_provider or (lambda app: [])
        self.footer_provider = footer_provider or (lambda app: "")
        self.on_tick = on_tick or (lambda app: None)
        self.running = self.exit_pending = False
        self.last_frame_lines = self.last_cols = self.last_rows = None
        self._last_tick = 0.0
        self._console_input = None

    @property
    def page(self):
        return self.pages[self.current_page_index] if self.pages else None

    @property
    def columns(self):
        return max(48, int(getattr(self.output, "columns", 0) or shutil.get_terminal_size(fallback=(80, 24)).columns))

    @property
    def rows(self):
        return max(14, int(getattr(self.output, "rows", 0) or shutil.get_terminal_size(fallback=(80, 24)).lines))

    @property
    def content_height(self):
        return max(4, self.rows - 9)

    def switch_page(self, index):
        if 0 <= int(index) < len(self.pages):
            self.current_page_index = int(index)
            if callable(getattr(self.page, "on_enter", None)):
                self.page.on_enter(self)
            self.request_render()

    @staticmethod
    def _interactive_terminal():
        return bool(sys.stdin.isatty() and sys.stdout.isatty())

    def start(self):
        if self.running:
            return
        if os.name == "nt":
            os.system("")
        self.running = True
        self.last_frame_lines = None
        if callable(getattr(self.page, "on_enter", None)):
            self.page.on_enter(self)
        if not self._interactive_terminal():
            self.request_render()
            return
        from console_input import WindowsConsoleInput
        self._console_input = WindowsConsoleInput()
        self.output.write(CODES["enterAltScreen"] + CODES["clearScreen"] + CODES["hideCursor"] + "\x1b[?7l")
        self._last_tick = time.monotonic()
        self.request_render()
        while self.running:
            for key in self._console_input.poll():
                self.dispatch_key(self.translate_char(key))
                if not self.running:
                    break
            if self.running:
                self.on_tick(self)
            now = time.monotonic()
            if now - self._last_tick >= 1:
                self._last_tick = now
                self.request_render()
            time.sleep(0.05)

    def stop(self):
        if not self.running:
            return
        self.running = False
        try:
            self.output.write(CODES["reset"] + "\x1b[?7h" + CODES["showCursor"] + CODES["leaveAltScreen"])
            self.output.flush()
        finally:
            if self._console_input is not None:
                self._console_input.close()
                self._console_input = None

    @staticmethod
    def translate_char(ch):
        return {"\r": "enter", "\n": "enter", "\x03": "ctrl-c", "\x7f": "backspace",
                "\x08": "backspace", "\t": "tab", "\x1b": "esc"}.get(ch, ch)

    def dispatch_key(self, key):
        if not key or key == "unknown":
            return
        if key == "ctrl-c":
            self.on_exit_request()
            return
        if self.exit_pending:
            return
        if self.page and hasattr(self.page, "handle_key") and self.page.handle_key(key, self) is True:
            self.request_render()
            return
        if key in ("left", "right") and self.pages:
            self.switch_page((self.current_page_index + (1 if key == "right" else -1)) % len(self.pages))
        elif key.isdigit() and 1 <= int(key) <= len(self.pages):
            self.switch_page(int(key) - 1)
        elif key == "q":
            self.switch_page(0)

    def request_render(self):
        if self.running:
            self.render()

    def build_menu_bar(self, columns):
        return fit("".join(colorize(f" {index + 1}{page.title} ", "reverse" if index == self.current_page_index else "brightBlue")
                           for index, page in enumerate(self.pages)), columns)

    def build_frame(self):
        columns = self.columns
        page_title = f"│ {self.page.key}.{self.page.title}" if self.page else ""
        lines = [colorize(fit(f" {self.title}  {page_title}", columns - 10), "brightCyan")
                 + colorize(fit(" " + format_clock(), 10), "gray")]
        status = self.status_bar_provider(self) or []
        lines += [fit(status[index] if index < len(status) else "", columns) for index in range(2)]
        lines += [self.build_menu_bar(columns), colorize("─" * columns, "gray")]
        content = self.page.render(self) if self.page and hasattr(self.page, "render") else []
        lines += [fit(content[index] if index < len(content) else "", columns) for index in range(self.content_height)]
        lines.append(colorize(fit("作者：黎路遥 ｜ 微信：luyao2089 ｜ 官网：luyao2089.cc", columns), "gray"))
        lines.append(colorize(fit("版权所有 © 黎路遥，保留所有权利", columns), "gray"))
        footer = self.footer_provider(self)
        if not footer and self.page and hasattr(self.page, "footer"):
            footer = self.page.footer(self)
        lines.append(colorize(fit(footer or "↑↓选择 回车执行 ←→/数字键切页 q首页 0首页退出 Ctrl+C停止并退出", columns), "gray"))
        lines.append("─" * columns)
        return lines

    def render(self):
        if not self.running:
            return
        cols, rows = self.columns, self.rows
        lines = self.build_frame()
        full = not self.last_frame_lines or self.last_cols != cols or self.last_rows != rows or len(self.last_frame_lines) != len(lines)
        self.last_cols, self.last_rows = cols, rows
        if full:
            output = CODES["clearScreen"] + CODES["cursorHome"] + "\r\n".join(lines)
        else:
            output = "".join(move_to(index + 1, 1) + CODES["reset"] + clear_line() + line
                             for index, line in enumerate(lines) if line != self.last_frame_lines[index])
        self.last_frame_lines = lines
        if output:
            self.output.write(output)
            self.output.flush()
