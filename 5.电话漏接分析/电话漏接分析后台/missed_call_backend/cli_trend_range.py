"""该文件负责 CLI 趋势和时间段总览共用的范围选择。"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from .cli_data import (
    CachedCallRecords,
    build_period_call_summary,
    date_range_label,
    earliest_result_day,
    filter_cached_records_by_dates,
    latest_result_day,
    previous_calendar_month_range,
)
from .cli_display import print_menu, print_message, print_table, print_title
from .cli_input import format_rate, parse_local_datetime, prompt_menu_choice, prompt_text, wait_for_enter


@dataclass(frozen=True)
class TimeRangeSelection:
    """保存页面实际采用的日期范围和可读标题。"""

    start_day: date | None
    end_day: date | None
    label: str


def prompt_custom_date_range() -> tuple[date, date]:
    """读取包含首尾日期的自定义自然日范围。"""
    while True:
        start_datetime = parse_local_datetime(prompt_text("开始日期（YYYY-MM-DD）：", ""))
        end_datetime = parse_local_datetime(prompt_text("结束日期（YYYY-MM-DD）：", ""))
        if start_datetime and end_datetime and start_datetime.date() <= end_datetime.date():
            return start_datetime.date(), end_datetime.date()
        print_message("日期格式无效，或开始日期晚于结束日期，请重新输入。", "warning")


def prompt_time_range_selection(result: dict[str, Any]) -> TimeRangeSelection:
    """读取统一的趋势和总览时间范围。"""
    range_menu = [("1", "全部"), ("2", "近7天"), ("3", "近30天"), ("4", "近90天"), ("5", "上个月"), ("6", "自定义日期")]
    print_menu(range_menu)
    choice = prompt_menu_choice("选择查看范围（默认1）：", {key for key, _label in range_menu}, "1")
    if choice == "6":
        start_day, end_day = prompt_custom_date_range()
        return TimeRangeSelection(start_day, end_day, date_range_label(start_day, end_day, "自定义"))
    if choice == "5":
        start_day, end_day = previous_calendar_month_range()
        return TimeRangeSelection(start_day, end_day, date_range_label(start_day, end_day, "上个月"))
    if choice == "1":
        start_day = earliest_result_day(result)
        end_day = latest_result_day(result)
        return TimeRangeSelection(start_day, end_day, date_range_label(start_day, end_day, "全部"))
    latest_day = latest_result_day(result)
    range_days = {"2": 7, "3": 30, "4": 90}[choice]
    start_day = latest_day - timedelta(days=range_days - 1) if latest_day else None
    return TimeRangeSelection(start_day, latest_day, date_range_label(start_day, latest_day, f"近{range_days}天"))


def print_period_call_summary(records: CachedCallRecords) -> None:
    """显示选定日期范围内的呼入和呼出总览。"""
    summary = build_period_call_summary(records)
    print_table(
        ["项目", "数量"],
        [
            ["呼入总数", summary["inboundCount"]],
            ["呼入成功数", summary["successfulInboundCount"]],
            ["呼入成功率", format_rate(summary["inboundSuccessRate"])],
            ["呼出总数", summary["outboundCount"]],
            ["呼出成功数", summary["successfulOutboundCount"]],
            ["呼出成功率", format_rate(summary["outboundSuccessRate"])],
        ],
    )


def show_period_summary(application: Any) -> None:
    """运行独立的时间段通话总览页面。"""
    result = application.require_result()
    if not result:
        return
    selection = prompt_time_range_selection(result)
    records = application.ensure_cached_records()
    if selection.start_day and selection.end_day:
        records = filter_cached_records_by_dates(records, selection.start_day, selection.end_day)
    else:
        records = CachedCallRecords([], [], [])
    print_title("时间段通话总览", selection.label)
    print_period_call_summary(records)
    wait_for_enter("按回车返回主菜单...")
