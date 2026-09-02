"""该文件负责 CLI 的输入、菜单选择和分页交互。"""
from __future__ import annotations

import getpass
from datetime import datetime
from typing import Sequence

from .cli_display import clear_screen, print_message, print_table


DEFAULT_LONG_LIST_PAGE_SIZE = 25


def prompt_text(prompt: str, default: str = "") -> str:
    """读取一行输入，空输入时保留默认值。"""
    try:
        value = input(prompt)
    except EOFError:
        return default
    return value.strip() if value.strip() else default


def wait_for_enter(prompt: str) -> None:
    """等待用户返回菜单，非交互输入结束时也要正常收尾。"""
    try:
        input(prompt)
    except EOFError:
        return


def prompt_secret(prompt: str, default: str = "") -> str:
    """读取密码，空输入时保留当前密码。"""
    try:
        value = getpass.getpass(prompt)
    except (EOFError, KeyboardInterrupt):
        return default
    return value if value else default


def prompt_menu_choice(prompt: str, allowed: set[str], default: str = "") -> str:
    """读取一个受限菜单选项。"""
    while True:
        value = prompt_text(prompt, default)
        if value in allowed:
            clear_screen()
            return value
        print_message(f"请输入：{'、'.join(sorted(allowed))}", "warning")


def format_rate(value: float | int) -> str:
    """把百分比统一显示为一位小数。"""
    return f"{float(value or 0):.1f}%"


def parse_local_datetime(value: object) -> datetime | None:
    """解析项目中常见的本地时间文本。"""
    text = str(value or "").strip()
    if not text or text == "无":
        return None
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    return None


def paged_rows(headers: Sequence[str], rows: list[list[object]], page_size: int = DEFAULT_LONG_LIST_PAGE_SIZE) -> None:
    """按页显示长列表。"""
    if not rows:
        print_message("暂无数据。", "warning")
        return
    total_pages = max(1, (len(rows) + page_size - 1) // page_size)
    page_number = 1
    while True:
        start_index = (page_number - 1) * page_size
        print_message(f"第 {page_number}/{total_pages} 页，共 {len(rows)} 条", "muted")
        print_table(headers, rows[start_index : start_index + page_size])
        if total_pages == 1:
            return
        command = prompt_text("输入 n 下一页、p 上一页、页码跳转，回车返回：", "")
        if not command:
            return
        if command == "n":
            page_number = min(total_pages, page_number + 1)
        elif command == "p":
            page_number = max(1, page_number - 1)
        elif command.isdigit():
            page_number = max(1, min(total_pages, int(command)))
