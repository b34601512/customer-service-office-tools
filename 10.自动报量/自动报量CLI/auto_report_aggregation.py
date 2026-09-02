from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Callable


@dataclass
class ReportAggregationResult:
    """保存一次日期范围聚合的全部结果和异常样例。"""

    row_date_shift_quantity: dict[int, dict[str, dict[str, float]]] = field(default_factory=dict)
    total_rows: int = 0
    valid_rows: int = 0
    matched_rows: int = 0
    unmatched_rows: int = 0
    filtered_rows: int = 0
    written_quantity: float = 0
    skipped_by_reason: Counter[str] = field(default_factory=Counter)
    unmatched_examples: list[str] = field(default_factory=list)
    duplicate_hit_examples: list[str] = field(default_factory=list)


def clean_order_cell(raw_value: Any) -> str:
    """清理订单字段中的制表符和空白。"""
    return str(raw_value if raw_value is not None else "").replace("\t", "").strip()


def parse_order_number(raw_value: Any) -> float:
    """解析订单数量，兼容千分位和空值。"""
    numeric_text = clean_order_cell(raw_value).replace(",", "")
    if not numeric_text:
        return 0
    try:
        numeric_value = float(numeric_text)
    except ValueError:
        return 0
    return numeric_value if numeric_value == numeric_value else 0


def parse_payment_datetime(raw_value: Any) -> datetime | None:
    """严格读取订单付款时间。"""
    payment_time_text = clean_order_cell(raw_value)
    payment_time_match = re.match(
        r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?",
        payment_time_text,
    )
    if not payment_time_match:
        return None
    try:
        return datetime(
            int(payment_time_match.group(1)),
            int(payment_time_match.group(2)),
            int(payment_time_match.group(3)),
            int(payment_time_match.group(4)),
            int(payment_time_match.group(5)),
            int(payment_time_match.group(6) or 0),
        )
    except ValueError:
        return None


def format_date_text(target_date: date) -> str:
    """把日期格式化成报量表使用的文本。"""
    return target_date.isoformat()


def parse_clock_minutes(clock_text: Any) -> float:
    """把班次结束时间转换成分钟数。"""
    clock_parts = str(clock_text or "16:00").split(":")
    try:
        return int(clock_parts[0]) * 60 + int(clock_parts[1])
    except (IndexError, ValueError):
        return 16 * 60


def resolve_order_date_and_shift(payment_datetime: datetime, report_config: dict[str, Any]) -> tuple[str, str]:
    """按付款时间和班次配置得到业务日期与白夜班。"""
    day_end_minutes = parse_clock_minutes(report_config.get("shift", {}).get("dayEnd", "16:00"))
    payment_minutes = payment_datetime.hour * 60 + payment_datetime.minute + payment_datetime.second / 60
    shift_name = "day" if payment_minutes <= day_end_minutes else "night"
    return format_date_text(payment_datetime.date()), shift_name


def build_order_mapping_index(product_rows: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    """建立店铺和料号到报量行的索引。"""
    mapping_index: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for product_row in product_rows:
        for store_name in product_row.get("stores", []):
            for material_code in product_row.get("materialCodes", []):
                mapping_index.setdefault(
                    (clean_order_cell(store_name), clean_order_cell(material_code)),
                    [],
                ).append(product_row)
    return mapping_index


def get_order_filter_reason(order_record: dict[str, Any], report_config: dict[str, Any]) -> str:
    """执行取消、作废、退款和赠品过滤。"""
    source_columns = report_config["sourceColumns"]
    filters = report_config["filters"]
    trade_status = clean_order_cell(order_record.get(source_columns["tradeStatus"]))
    if trade_status in filters.get("excludedTradeStatuses", []):
        return f"交易状态排除：{trade_status}"
    if clean_order_cell(order_record.get(source_columns["voidFlag"])) in filters.get("excludedVoidValues", []):
        return "作废排除：是"
    if clean_order_cell(order_record.get(source_columns["refundFlag"])) in filters.get("excludedRefundValues", []):
        return "退款排除：退款成功"
    if clean_order_cell(order_record.get(source_columns["giftFlag"])) in filters.get("excludedGiftValues", []):
        return "赠品排除：是"
    return ""


def normalize_product_text(product_name: Any) -> str:
    """去掉产品价格和空白，用于重复料号优先匹配。"""
    return re.sub(r"（[^）]*）", "", clean_order_cell(product_name)).replace(" ", "")


def choose_product_row(
    matched_product_rows: list[dict[str, Any]],
    material_code: str,
    report_config: dict[str, Any],
) -> dict[str, Any]:
    """重复料号命中多行时选择配置中更可信的报量行。"""
    if len(matched_product_rows) <= 1:
        return matched_product_rows[0]
    preferred_product_name = report_config.get("materialCodePreferredProductName", {}).get(material_code, "")
    preferred_product_text = normalize_product_text(preferred_product_name)
    if preferred_product_text:
        for product_row in matched_product_rows:
            if preferred_product_text in normalize_product_text(product_row.get("productName")):
                return product_row
    return matched_product_rows[0]


def remember_example(example_list: list[str], example_text: str, maximum_count: int = 20) -> None:
    """保留有限数量的异常样例，避免日志失控。"""
    if len(example_list) < maximum_count and example_text not in example_list:
        example_list.append(example_text)


def add_aggregated_quantity(
    aggregation_result: ReportAggregationResult,
    product_row_number: int,
    date_text: str,
    shift_name: str,
    quantity: float,
) -> None:
    """累加同一报量行、日期和班次的数量。"""
    date_quantity_map = aggregation_result.row_date_shift_quantity.setdefault(product_row_number, {})
    shift_quantity = date_quantity_map.setdefault(date_text, {"day": 0, "night": 0})
    shift_quantity[shift_name] += quantity


def aggregate_order_records(
    order_records: list[dict[str, Any]],
    report_config: dict[str, Any],
    start_date: date,
    end_date: date,
    progress_callback: Callable[[int, int], None] | None = None,
) -> ReportAggregationResult:
    """按日期范围过滤、映射并汇总订单。"""
    aggregation_result = ReportAggregationResult(total_rows=len(order_records))
    mapping_index = build_order_mapping_index(report_config["productRows"])
    source_columns = report_config["sourceColumns"]
    for record_index, order_record in enumerate(order_records, start=1):
        if progress_callback is not None:
            progress_callback(record_index, len(order_records))
        filter_reason = get_order_filter_reason(order_record, report_config)
        if filter_reason:
            aggregation_result.filtered_rows += 1
            aggregation_result.skipped_by_reason[filter_reason] += 1
            continue
        payment_datetime = parse_payment_datetime(order_record.get(source_columns["paymentTime"]))
        if payment_datetime is None:
            aggregation_result.filtered_rows += 1
            aggregation_result.skipped_by_reason["付款时间为空或格式错误"] += 1
            continue
        order_date_text, shift_name = resolve_order_date_and_shift(payment_datetime, report_config)
        order_date = payment_datetime.date()
        if order_date < start_date or order_date > end_date:
            aggregation_result.skipped_by_reason["不在导入日期范围"] += 1
            continue
        aggregation_result.valid_rows += 1
        store_name = clean_order_cell(order_record.get(source_columns["storeName"]))
        material_code = clean_order_cell(order_record.get(source_columns["materialCode"]))
        order_quantity = parse_order_number(order_record.get(source_columns["quantity"]))
        matched_product_rows = mapping_index.get((store_name, material_code), [])
        if not matched_product_rows:
            aggregation_result.unmatched_rows += 1
            remember_example(
                aggregation_result.unmatched_examples,
                f"{store_name} / {material_code}",
            )
            continue
        target_product_row = choose_product_row(matched_product_rows, material_code, report_config)
        if len(matched_product_rows) > 1:
            remember_example(
                aggregation_result.duplicate_hit_examples,
                (
                    f"{store_name} / {material_code} 命中多行，已写入第{target_product_row['row']}行："
                    + "；".join(
                        f"{item['row']}{item['productName']}" for item in matched_product_rows
                    )
                ),
            )
        add_aggregated_quantity(
            aggregation_result,
            int(target_product_row["row"]),
            order_date_text,
            shift_name,
            order_quantity,
        )
        aggregation_result.matched_rows += 1
        aggregation_result.written_quantity += order_quantity
    return aggregation_result


def iter_date_texts(start_date: date, end_date: date) -> list[str]:
    """生成包含首尾日期的日期文本列表。"""
    date_texts: list[str] = []
    current_date = start_date
    while current_date <= end_date:
        date_texts.append(format_date_text(current_date))
        current_date += timedelta(days=1)
    return date_texts
