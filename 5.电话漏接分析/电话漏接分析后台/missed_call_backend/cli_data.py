"""该文件负责 CLI 使用的缓存报表读取、时间范围和视图数据。"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from .analysis import build_agent_summary, build_inbound_records, build_loss_records, build_outbound_records
from .normalizers import format_seconds
from .raw_table_store import result_raw_tables
from .result_cache import load_latest_download_result
from .state_store import load_agent_mapping


TIME_RANGE_OPTIONS: tuple[tuple[int, str], ...] = ((0, "全部"), (7, "近7天"), (30, "近30天"), (90, "近90天"))


@dataclass
class CachedCallRecords:
    """保留一份最新记录的原始解析结果，避免每次切换图表都重新读 Excel。"""

    loss_records: list[dict[str, Any]]
    inbound_records: list[dict[str, Any]]
    outbound_records: list[dict[str, Any]]


def load_latest_result() -> dict[str, Any] | None:
    """读取最新结果并合并当前回访状态。"""
    return load_latest_download_result()


def load_cached_call_records(result: dict[str, Any]) -> CachedCallRecords:
    """把结果中的同一份原始行转换成客服统计使用的记录。"""
    raw_tables = result_raw_tables(result)
    return CachedCallRecords(
        loss_records=build_loss_records(raw_tables["loss"]),
        inbound_records=build_inbound_records(raw_tables["inbound"]),
        outbound_records=build_outbound_records(raw_tables["outbound"]),
    )


def parse_day(value: str) -> date | None:
    """解析趋势数据使用的自然日文本。"""
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def result_day_bounds(result: dict[str, Any]) -> tuple[date | None, date | None]:
    """取当前结果的最早和最晚自然日。"""
    rows = ((result.get("charts") or {}).get("trendSummary") or {}).get("rows") or []
    days = [day for day in (parse_day(row.get("date")) for row in rows) if day]
    return (min(days), max(days)) if days else (None, None)


def earliest_result_day(result: dict[str, Any]) -> date | None:
    """取当前数据的最早自然日。"""
    return result_day_bounds(result)[0]


def latest_result_day(result: dict[str, Any]) -> date | None:
    """取当前数据的最新自然日，而不是用电脑今天日期猜测数据范围。"""
    return result_day_bounds(result)[1]


def previous_calendar_month_range(reference_day: date | None = None) -> tuple[date, date]:
    """计算参考日期所在月份的上一个自然月。"""
    current_day = reference_day or date.today()
    current_month_start = current_day.replace(day=1)
    previous_month_end = current_month_start - timedelta(days=1)
    return previous_month_end.replace(day=1), previous_month_end


def date_range_label(start_day: date | None, end_day: date | None, period_label: str) -> str:
    """把实际起止日期和范围名称合并成页面标题。"""
    if not start_day or not end_day:
        return "无数据"
    return f"{start_day.isoformat()} 至 {end_day.isoformat()}（{period_label}）"


def range_label(range_days: int, latest_day: date | None, earliest_day: date | None = None) -> str:
    """生成用户能直接理解的范围说明。"""
    if not latest_day:
        return "无数据"
    if not range_days:
        return date_range_label(earliest_day or latest_day, latest_day, "全部")
    start_day = latest_day - timedelta(days=range_days - 1)
    return date_range_label(start_day, latest_day, f"近{range_days}天")


def split_ivr_loss(loss_count: Any, queue_loss_count: Any) -> int:
    """按“呼损 = IVR呼损 + 排队呼损”口径拆出 IVR 呼损。"""
    total = int(float(loss_count or 0))
    queue = int(float(queue_loss_count or 0))
    return max(0, total - queue)


def format_trend_change(current_value: float, previous_value: float) -> str:
    """把当天与前一天的差异转换成可直接阅读的文本。"""
    difference = current_value - previous_value
    if difference == 0:
        return "→0（0.0%）"
    if previous_value == 0:
        direction = "↑" if difference > 0 else "↓"
        return f"{direction}{abs(int(difference))}（前日0）"
    direction = "↑" if difference > 0 else "↓"
    change_rate = difference / previous_value * 100
    return f"{direction}{abs(int(difference))}（{change_rate:+.1f}%）"


def build_daily_trend_rows(
    rows: list[dict[str, Any]],
    value_key: str,
    rate_key: str = "",
    denominator_key: str = "",
    detail_value_keys: tuple[str, ...] = (),
) -> list[dict[str, Any]]:
    """生成每日数值、日变化和比例，供 CLI 逐行展示。

    detail_value_keys 用于把同行的其他数值字段（如 ivrLossCount、
    queueLossCount）一并带出，让明细表可以拆列展示。
    """
    daily_rows: list[dict[str, Any]] = []
    previous_value: float | None = None
    for row in rows:
        current_value = float(row.get(value_key) or 0)
        change_text = "—" if previous_value is None else format_trend_change(current_value, previous_value)
        if rate_key:
            rate_value = float(row.get(rate_key) or 0)
        elif denominator_key:
            rate_value = current_value / max(float(row.get(denominator_key) or 0), 1) * 100
        else:
            rate_value = None
        daily_row: dict[str, Any] = {"date": row.get("date") or row.get("name", ""), "value": int(current_value), "change": change_text, "rate": rate_value}
        for detail_key in detail_value_keys:
            daily_row[detail_key] = int(float(row.get(detail_key) or 0))
        daily_rows.append(daily_row)
        previous_value = current_value
    return daily_rows


def filter_records_by_range(
    records: list[dict[str, Any]],
    time_key: str,
    range_days: int,
    latest_day: date | None,
) -> list[dict[str, Any]]:
    """按当前数据最新日期筛选原始记录。"""
    if not range_days or not latest_day:
        return list(records)
    start_day = latest_day - timedelta(days=range_days - 1)
    return filter_records_by_date_range(records, time_key, start_day, latest_day)


def filter_records_by_date_range(
    records: list[dict[str, Any]],
    time_key: str,
    start_day: date,
    end_day: date,
) -> list[dict[str, Any]]:
    """按包含首尾日期的自然日范围筛选原始记录。"""
    return [
        record
        for record in records
        if isinstance(record.get(time_key), datetime)
        and start_day <= record[time_key].date() <= end_day
    ]


def filter_cached_records(records: CachedCallRecords, range_days: int, latest_day: date | None) -> CachedCallRecords:
    """按同一时间范围筛选呼损、呼入和呼出记录。"""
    return CachedCallRecords(
        loss_records=filter_records_by_range(records.loss_records, "loss_time", range_days, latest_day),
        inbound_records=filter_records_by_range(records.inbound_records, "inbound_time", range_days, latest_day),
        outbound_records=filter_records_by_range(records.outbound_records, "outbound_time", range_days, latest_day),
    )


def filter_cached_records_by_dates(records: CachedCallRecords, start_day: date, end_day: date) -> CachedCallRecords:
    """按自定义日期范围筛选呼损、呼入和呼出记录。"""
    return CachedCallRecords(
        loss_records=filter_records_by_date_range(records.loss_records, "loss_time", start_day, end_day),
        inbound_records=filter_records_by_date_range(records.inbound_records, "inbound_time", start_day, end_day),
        outbound_records=filter_records_by_date_range(records.outbound_records, "outbound_time", start_day, end_day),
    )


def filter_trend_rows_by_dates(result: dict[str, Any], start_day: date, end_day: date) -> list[dict[str, Any]]:
    """按自定义日期范围筛选每日趋势行，包含首尾日期。"""
    trend_rows = list((((result.get("charts") or {}).get("trendSummary") or {}).get("rows")) or [])
    return [row for row in trend_rows if (row_day := parse_day(row.get("date"))) and start_day <= row_day <= end_day]


def build_period_call_summary(records: CachedCallRecords) -> dict[str, int | float]:
    """汇总自定义日期范围内的呼入、呼出和成功数量。"""
    inbound_count = len(records.inbound_records)
    successful_inbound_count = sum(1 for record in records.inbound_records if float(record.get("talk_seconds") or 0) > 0)
    outbound_count = len(records.outbound_records)
    successful_outbound_count = sum(1 for record in records.outbound_records if float(record.get("talk_seconds") or 0) > 0)

    def calculate_success_rate(successful_count: int, total_count: int) -> float:
        """计算成功率，避免时间范围无数据时除零。"""
        return round(successful_count / total_count * 100, 1) if total_count else 0.0

    return {
        "inboundCount": inbound_count,
        "successfulInboundCount": successful_inbound_count,
        "inboundSuccessRate": calculate_success_rate(successful_inbound_count, inbound_count),
        "outboundCount": outbound_count,
        "successfulOutboundCount": successful_outbound_count,
        "outboundSuccessRate": calculate_success_rate(successful_outbound_count, outbound_count),
    }


def build_filtered_agent_summary(records: CachedCallRecords) -> list[dict[str, Any]]:
    """从筛选后的原始记录重新生成客服统计和对比数据。"""
    return build_agent_summary(records.inbound_records, records.outbound_records, load_agent_mapping())


def filter_agents_for_comparison(agents: list[dict[str, Any]], metric_choice: str) -> list[dict[str, Any]]:
    """只保留当前维度有数据且已识别姓名的客服，避免零值干扰对比。"""
    metric_keys = {"1": "totalContactCount", "2": "inboundCount", "3": "outboundCount", "4": "successfulOutboundCount"}
    metric_key = metric_keys.get(metric_choice, "totalContactCount")
    return [agent for agent in agents if agent.get("agentName") != "未填写" and float(agent.get(metric_key) or 0) > 0]


def format_duration(seconds: float | int) -> str:
    """把时长转换成当前项目统一使用的中文文本。"""
    return format_seconds(seconds)
