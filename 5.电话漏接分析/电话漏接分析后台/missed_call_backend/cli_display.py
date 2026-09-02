"""该文件负责命令行的颜色、字符图和表格显示。"""
from __future__ import annotations

import os
import re
import sys
import time
import unicodedata
from typing import Iterable, Sequence


ANSI_RESET = "\033[0m"
ANSI_COLORS = {
    "green": "\033[92m",
    "yellow": "\033[93m",
    "red": "\033[91m",
    "blue": "\033[94m",
    "cyan": "\033[96m",
    "muted": "\033[90m",
    "bold": "\033[1m",
    "brightRed": "\033[91m",
    "brightGreen": "\033[92m",
    "brightYellow": "\033[93m",
    "brightBlue": "\033[94m",
    "brightCyan": "\033[96m",
    "reverse": "\033[7m",
    "underline": "\033[4m",
    "dim": "\033[2m",
    "bgRed": "\033[41m",
    "bgGreen": "\033[42m",
    "bgYellow": "\033[43m",
    "bgBlue": "\033[44m",
    "bgCyan": "\033[46m",
}
ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
ANSI_PART_PATTERN = re.compile(r"(\x1b\[[0-9;]*[A-Za-z])")
_ZERO_WIDTH_JOINER = "\u200d"
_EMOJI_VARIATION_SELECTOR = "\ufe0f"
_KEYCAP_MARK = "\u20e3"

# 加载动画旋转符号：按帧循环，让用户知道任务未卡死。
_SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"


def spinner_frame(rate: float = 4.0) -> str:
    """返回当前旋转动画帧符号，按时间自动推进。

    所有"等待中"的提示统一调用本函数，避免各页面各自实现一套动画。
    """
    return _SPINNER_FRAMES[int(time.monotonic() * rate) % len(_SPINNER_FRAMES)]


def strip_ansi(value: object) -> str:
    """去掉 ANSI 转义序列，返回纯文本。"""
    return ANSI_PATTERN.sub("", str(value))
COLOR_OUTPUT_ENABLED = False


def configure_terminal() -> None:
    """统一终端编码并尽量开启 Windows ANSI 颜色。"""
    global COLOR_OUTPUT_ENABLED
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    if os.name == "nt":
        os.system("")
    COLOR_OUTPUT_ENABLED = bool(sys.stdout.isatty())


def colorize(text: object, color_name: str = "") -> str:
    """在终端支持颜色时给文本加颜色，否则返回原文本。"""
    text_value = str(text)
    color_code = ANSI_COLORS.get(color_name, "")
    if not COLOR_OUTPUT_ENABLED or not color_code:
        return text_value
    return f"{color_code}{text_value}{ANSI_RESET}"


def reverse_colorize(text: object) -> str:
    """给整行加反色，并避免行内颜色重置时截断反色背景。"""
    text_value = str(text)
    reverse_code = ANSI_COLORS["reverse"]
    if not COLOR_OUTPUT_ENABLED:
        return text_value
    # 单元格颜色会输出 ANSI_RESET（重置所有样式），需要在每次重置后
    # 重新打开反色，才能让高亮背景连续覆盖整行。
    preserved = text_value.replace(ANSI_RESET, ANSI_RESET + reverse_code)
    return f"{reverse_code}{preserved}{ANSI_RESET}"


def highlight_number(value: object, threshold: float = 1, color_name: str = "red") -> str:
    """数值达到阈值时标红，用于排队呼损等需要快速告警的列。"""
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return str(value)
    if numeric_value >= threshold:
        return colorize(str(value), color_name)
    return str(value)


def highlight_queue_detail(value: object) -> str:
    """排队呼损明细专用：0 显示绿色，大于等于 1 显示红色，其它文本原样。"""
    text = str(value)
    match = re.search(r"\d+", text)
    if not match:
        return text
    try:
        number = int(match.group())
    except ValueError:
        return text
    if number == 0:
        return colorize(text, "green")
    if number >= 1:
        return colorize(text, "red")
    return text


def highlight_queue_loss(value: object) -> str:
    """排队呼损数字列专用：0 绿色，大于等于 1 红色。"""
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return str(value)
    if number == 0:
        return colorize(str(value), "green")
    if number >= 1:
        return colorize(str(value), "red")
    return str(value)


def clear_screen() -> None:
    """清理当前画面和滚动历史，管道输出不插入控制字符。"""
    if not sys.stdout.isatty():
        return
    if os.name == "nt":
        os.system("cls")
    print("\033[3J\033[2J\033[H", end="", flush=True)


def print_title(title: str, subtitle: str = "") -> None:
    """打印统一的页面标题。"""
    clear_screen()
    print()
    print(colorize(f"{'=' * 4} {title} {'=' * 4}", "bold"))
    if subtitle:
        print(colorize(subtitle, "muted"))


def print_message(message: str, message_type: str = "info") -> None:
    """打印统一的提示信息。"""
    color_name = {"success": "green", "warning": "yellow", "error": "red"}.get(message_type, "cyan")
    print(colorize(message, color_name))


def print_menu(menu_items: Sequence[tuple[str, str]]) -> None:
    """打印数字菜单。"""
    for key, label in menu_items:
        print(f"  {colorize(key, 'cyan')}  {label}")


def display_width(value: object) -> int:
    """按完整可见字形计算终端列宽，并忽略 ANSI 颜色码。"""
    return sum(_grapheme_width(grapheme) for grapheme in _split_graphemes(strip_ansi(value)))


def _is_zero_width_code_point(character: str) -> bool:
    """判断码点是否只修饰相邻字符，本身不占终端列。"""
    return unicodedata.category(character) in {"Mn", "Mc", "Me", "Cf"}


def _is_emoji_modifier(character: str) -> bool:
    code_point = ord(character)
    return 0x1F3FB <= code_point <= 0x1F3FF


def _is_regional_indicator(character: str) -> bool:
    code_point = ord(character)
    return 0x1F1E6 <= code_point <= 0x1F1FF


def _split_graphemes(text: str) -> list[str]:
    """合并常见组合字形：附加符、肤色、旗帜及 ZWJ 表情序列。"""
    graphemes: list[str] = []
    current = ""
    regional_indicator_count = 0
    for character in str(text or ""):
        character_is_regional = _is_regional_indicator(character)
        if not current:
            current = character
            regional_indicator_count = 1 if character_is_regional else 0
            continue

        joins_current = (
            _is_zero_width_code_point(character)
            or _is_emoji_modifier(character)
            or current.endswith(_ZERO_WIDTH_JOINER)
            or (character_is_regional and regional_indicator_count == 1)
        )
        if joins_current:
            current += character
            if character_is_regional:
                regional_indicator_count += 1
            continue

        graphemes.append(current)
        current = character
        regional_indicator_count = 1 if character_is_regional else 0

    if current:
        graphemes.append(current)
    return graphemes


def _grapheme_width(grapheme: str) -> int:
    """返回一个完整字形在 Windows 等宽终端中的列宽。"""
    base_character = next(
        (character for character in grapheme if not _is_zero_width_code_point(character)),
        "",
    )
    if not base_character:
        return 0
    if _EMOJI_VARIATION_SELECTOR in grapheme or _KEYCAP_MARK in grapheme:
        return 2
    if any(_is_regional_indicator(character) for character in grapheme):
        return 2
    return 2 if unicodedata.east_asian_width(base_character) in {"W", "F"} else 1


def pad_text(value: object, width: int, align: str = "left") -> str:
    """按终端宽度补齐文本，支持带 ANSI 颜色的文本。"""
    text_value = str(value)
    padding = max(0, width - display_width(text_value))
    if align == "right":
        return " " * padding + text_value
    return text_value + " " * padding


def truncate_text(value: object, width: int) -> str:
    """按完整字形截断文本，保留 ANSI 颜色边界并添加省略号。"""
    text_value = "" if value is None else str(value)
    if display_width(text_value) <= width:
        return text_value
    if width <= 0:
        return ""

    content_width = max(0, width - display_width("…"))
    result: list[str] = []
    current_width = 0
    had_escape = False
    reached_boundary = False
    for part in ANSI_PART_PATTERN.split(text_value):
        if not part:
            continue
        if ANSI_PATTERN.fullmatch(part):
            result.append(part)
            had_escape = True
            continue
        for grapheme in _split_graphemes(part):
            grapheme_width = _grapheme_width(grapheme)
            if current_width + grapheme_width > content_width:
                reached_boundary = True
                break
            result.append(grapheme)
            current_width += grapheme_width
        if reached_boundary:
            break
    return "".join(result) + (ANSI_RESET if had_escape else "") + "…"


def fit_text(value: object, width: int, truncate: bool = True) -> str:
    """把文本精确适配到终端列宽；截断后仍补齐到目标宽度。"""
    # 保持原 TUI 的输入语义：_fit 过去也会先执行 str(value)。
    text_value = str(value)
    if display_width(text_value) <= width:
        return pad_text(text_value, width)
    if not truncate:
        return text_value
    return pad_text(truncate_text(text_value, width), width)


def shorten_text(value: object, max_length: int = 30) -> str:
    """限制列表中的长文本，避免一条记录撑宽整个终端。

    宽度和截断都复用终端字形真源，避免拆开组合字符或颜色序列。
    """
    text_value = "" if value is None else str(value)
    if display_width(text_value) <= max_length:
        return text_value
    return truncate_text(text_value, max_length)


def build_table_lines(headers: Sequence[str], rows: Iterable[Sequence[object]]) -> list[str]:
    """生成不依赖第三方库的等宽表格行，支持带 ANSI 颜色的单元格。"""
    normalized_rows = [[shorten_text(cell) for cell in row] for row in rows]
    if not normalized_rows:
        return [colorize("暂无数据。", "muted")]
    column_count = len(headers)
    safe_rows = [row + [""] * (column_count - len(row)) for row in normalized_rows]
    widths = [display_width(header) for header in headers]
    for row in safe_rows:
        for index in range(column_count):
            widths[index] = max(widths[index], display_width(row[index]))
    separator = "-+-".join("-" * width for width in widths)
    lines = [
        " | ".join(colorize(pad_text(header, widths[index]), "cyan") for index, header in enumerate(headers)),
        colorize(separator, "muted"),
    ]
    for row in safe_rows:
        lines.append(" | ".join(pad_text(row[index], widths[index]) for index in range(column_count)))
    return lines


def print_table(headers: Sequence[str], rows: Iterable[Sequence[object]]) -> None:
    """打印不依赖第三方库的等宽表格。"""
    for line in build_table_lines(headers, rows):
        print(line)


def render_bar(value: float, maximum: float, width: int = 24, bar_character: str = "█") -> str:
    """把数值转换为可比较的横向字符条。"""
    numeric_value = max(0.0, float(value or 0))
    numeric_maximum = max(1.0, float(maximum or 0))
    filled_width = min(width, max(0 if numeric_value == 0 else 1, round(numeric_value / numeric_maximum * width)))
    return bar_character * filled_width + " " * (width - filled_width)


def print_named_bars(title: str, items: list[dict[str, object]]) -> None:
    """显示名称和值组成的横向字符条。"""
    print_message(f"\n{title}", "bold")
    maximum = max([float(item.get("value") or 0) for item in items] or [1])
    for item in items:
        value = float(item.get("value") or 0)
        bar = render_bar(value, maximum)
        print(f"{pad_text(shorten_text(item.get('name') or '未知', 16), 16)} {colorize(bar, 'green')} {int(value)}")


def build_daily_trend_table_rows(
    daily_rows: Sequence[dict[str, object]],
    include_rate: bool = True,
    detail_value_keys: Sequence[str] = (),
    bar_key: str = "value",
) -> list[list[object]]:
    """把每日趋势数据转换成带数值、条形和变化的表格行。

    detail_value_keys 指定需要在"呼损"之后额外展示的明细列（如 IVR 呼损、排队呼损）。
    bar_key 指定趋势条对应的数值字段，默认用主值（value），可改为 queueLossCount 等。
    """
    maximum = max([float(row.get(bar_key) or 0) for row in daily_rows] or [1])
    table_rows: list[list[object]] = []
    for row in daily_rows:
        table_row: list[object] = [row.get("date", ""), row.get("value", 0)]
        for detail_key in detail_value_keys:
            table_row.append(row.get(detail_key, 0))
        table_row.append(render_bar(float(row.get(bar_key) or 0), maximum))
        table_row.append(row.get("change", "—"))
        if include_rate:
            rate_value = row.get("rate")
            table_row.append("—" if rate_value is None else f"{float(rate_value):.1f}%")
        table_rows.append(table_row)
    return table_rows


def print_progress_bar(progress: int, message: str) -> None:
    """打印长任务当前状态，不依赖光标控制也能保留完整日志。"""
    safe_progress = max(0, min(100, int(progress or 0)))
    print(f"[{safe_progress:>3}%] {message}")
