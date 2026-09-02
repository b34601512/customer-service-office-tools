from __future__ import annotations

import math
import re
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from xml.etree import ElementTree
from typing import Any

from auto_report_aggregation import ReportAggregationResult


MAIN_XML_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELATIONSHIP_XML_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_RELATIONSHIP_XML_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"

CELL_TAG = f"{{{MAIN_XML_NAMESPACE}}}c"
ROW_TAG = f"{{{MAIN_XML_NAMESPACE}}}row"
VALUE_TAG = f"{{{MAIN_XML_NAMESPACE}}}v"
FORMULA_TAG = f"{{{MAIN_XML_NAMESPACE}}}f"
INLINE_STRING_TAG = f"{{{MAIN_XML_NAMESPACE}}}is"
SHEET_DATA_TAG = f"{{{MAIN_XML_NAMESPACE}}}sheetData"


@dataclass
class DateColumnInfo:
    """保存一天对应的白班、夜班、汇总和顶部列。"""

    date_text: str
    day_column_number: int
    night_column_number: int
    summary_column_number: int
    top_daily_column_number: int


@dataclass
class MonthWriteResult:
    """保存一个月份工作表的写入结果。"""

    sheet_name: str
    target_date_count: int
    written_quantity: float
    product_total_quantity: float
    product_total_amount: float
    summary_group_count: int


def register_xml_namespaces() -> None:
    """固定常见Excel命名空间前缀。"""
    ElementTree.register_namespace("", MAIN_XML_NAMESPACE)
    ElementTree.register_namespace("r", RELATIONSHIP_XML_NAMESPACE)
    ElementTree.register_namespace("xcalcf", "http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures")
    ElementTree.register_namespace("dbsheet", "http://web.wps.cn/et/2021/dbsheet")


def qualified_xml_name(namespace: str, local_name: str) -> str:
    """生成带命名空间的XML标签名。"""
    return f"{{{namespace}}}{local_name}"


def serialize_xml_document(xml_root: ElementTree.Element) -> bytes:
    """把XML树序列化为xlsx内部文件。"""
    return ElementTree.tostring(xml_root, encoding="utf-8", xml_declaration=True)


def parse_cell_reference(cell_reference: str) -> tuple[int, int]:
    """把Excel单元格引用拆成列号和行号。"""
    match = re.fullmatch(r"([A-Z]+)(\d+)", cell_reference or "")
    if not match:
        raise RuntimeError(f"非法单元格引用：{cell_reference}")
    column_number = 0
    for character in match.group(1):
        column_number = column_number * 26 + ord(character) - ord("A") + 1
    return column_number, int(match.group(2))


def build_cell_reference(column_number: int, row_number: int) -> str:
    """把列号和行号组合为Excel单元格引用。"""
    current_column_number = column_number
    column_name = ""
    while current_column_number > 0:
        remainder = (current_column_number - 1) % 26
        column_name = chr(ord("A") + remainder) + column_name
        current_column_number = (current_column_number - 1) // 26
    return f"{column_name}{row_number}"


def parse_excel_serial_date(serial_value: float) -> str:
    """把Excel日期序列号转换成日期文本。"""
    target_date = date(1899, 12, 30) + timedelta(days=round(serial_value))
    return target_date.isoformat()


def parse_raw_number(raw_value: str | None) -> float:
    """解析Excel内部数字。"""
    try:
        numeric_value = float((raw_value or "0").replace(",", ""))
    except ValueError:
        return 0
    return numeric_value if math.isfinite(numeric_value) else 0


def read_zip_entries(workbook_path: Path) -> dict[str, bytes]:
    """读取xlsx压缩包中的全部内部文件。"""
    with ZipFile(workbook_path, "r") as workbook_zip:
        return {
            entry_name: workbook_zip.read(entry_name)
            for entry_name in workbook_zip.namelist()
        }


def read_shared_strings(zip_entries: dict[str, bytes]) -> list[str]:
    """读取共享字符串，兼容富文本字符串。"""
    shared_strings_bytes = zip_entries.get("xl/sharedStrings.xml")
    if shared_strings_bytes is None:
        return []
    shared_strings_root = ElementTree.fromstring(shared_strings_bytes)
    shared_string_tag = qualified_xml_name(MAIN_XML_NAMESPACE, "si")
    return [
        "".join(shared_string_element.itertext())
        for shared_string_element in shared_strings_root.findall(f".//{shared_string_tag}")
    ]


def resolve_zip_target(source_path: str, target_path: str) -> str:
    """把关系文件中的相对目标转换成压缩包路径。"""
    if target_path.startswith("/"):
        return target_path.lstrip("/")
    source_parts = source_path.split("/")[:-1]
    target_parts = source_parts + target_path.replace("\\", "/").split("/")
    normalized_parts: list[str] = []
    for path_part in target_parts:
        if not path_part or path_part == ".":
            continue
        if path_part == "..":
            if normalized_parts:
                normalized_parts.pop()
            continue
        normalized_parts.append(path_part)
    return "/".join(normalized_parts)


def read_workbook_sheet_paths(zip_entries: dict[str, bytes]) -> dict[str, str]:
    """读取工作表名称到xlsx内部路径的映射。"""
    workbook_root = ElementTree.fromstring(zip_entries["xl/workbook.xml"])
    relationship_root = ElementTree.fromstring(zip_entries["xl/_rels/workbook.xml.rels"])
    relationship_tag = qualified_xml_name(PACKAGE_RELATIONSHIP_XML_NAMESPACE, "Relationship")
    relationship_targets = {
        relationship.get("Id", ""): relationship.get("Target", "")
        for relationship in relationship_root.findall(relationship_tag)
    }
    sheet_tag = qualified_xml_name(MAIN_XML_NAMESPACE, "sheet")
    sheet_paths: dict[str, str] = {}
    for sheet_element in workbook_root.findall(f".//{sheet_tag}"):
        relationship_id = sheet_element.get(
            qualified_xml_name(RELATIONSHIP_XML_NAMESPACE, "id"),
            "",
        )
        relationship_target = relationship_targets.get(relationship_id)
        if relationship_target:
            sheet_paths[sheet_element.get("name", "")] = resolve_zip_target(
                "xl/workbook.xml",
                relationship_target,
            )
    return sheet_paths


def build_cell_map(sheet_root: ElementTree.Element) -> dict[str, ElementTree.Element]:
    """建立单元格引用到XML元素的索引。"""
    return {
        cell_element.get("r"): cell_element
        for cell_element in sheet_root.iter(CELL_TAG)
        if cell_element.get("r")
    }


def read_cell_value(
    cell_map: dict[str, ElementTree.Element],
    cell_reference: str,
    shared_strings: list[str],
) -> str:
    """读取单元格显示值。"""
    cell_element = cell_map.get(cell_reference)
    if cell_element is None:
        return ""
    value_element = cell_element.find(VALUE_TAG)
    if value_element is None:
        return ""
    raw_value = value_element.text or ""
    if cell_element.get("t") == "s":
        shared_string_index = int(raw_value or 0)
        return shared_strings[shared_string_index] if shared_string_index < len(shared_strings) else ""
    return raw_value


def read_number_cell(cell_map: dict[str, ElementTree.Element], cell_reference: str) -> float:
    """读取数字单元格，空值按0处理。"""
    cell_element = cell_map.get(cell_reference)
    if cell_element is None:
        return 0
    value_element = cell_element.find(VALUE_TAG)
    return parse_raw_number(value_element.text if value_element is not None else "0")


def ensure_cell(
    sheet_root: ElementTree.Element,
    cell_map: dict[str, ElementTree.Element],
    cell_reference: str,
) -> ElementTree.Element:
    """确保目标单元格存在并保持XML行列顺序。"""
    if cell_reference in cell_map:
        return cell_map[cell_reference]
    column_number, row_number = parse_cell_reference(cell_reference)
    sheet_data_element = sheet_root.find(f".//{SHEET_DATA_TAG}")
    if sheet_data_element is None:
        raise RuntimeError("工作表缺少sheetData节点。")
    row_element = next(
        (
            candidate_row
            for candidate_row in sheet_data_element.findall(ROW_TAG)
            if int(candidate_row.get("r", "0")) == row_number
        ),
        None,
    )
    if row_element is None:
        row_element = ElementTree.Element(ROW_TAG, {"r": str(row_number)})
        row_insert_index = next(
            (
                index
                for index, candidate_row in enumerate(sheet_data_element)
                if int(candidate_row.get("r", "0")) > row_number
            ),
            len(sheet_data_element),
        )
        sheet_data_element.insert(row_insert_index, row_element)
    cell_element = ElementTree.Element(CELL_TAG, {"r": cell_reference})
    cell_insert_index = next(
        (
            index
            for index, candidate_cell in enumerate(row_element)
            if parse_cell_reference(candidate_cell.get("r", "A1"))[0] > column_number
        ),
        len(row_element),
    )
    row_element.insert(cell_insert_index, cell_element)
    cell_map[cell_reference] = cell_element
    return cell_element


def remove_direct_children(cell_element: ElementTree.Element, child_tags: set[str]) -> None:
    """删除单元格中指定的直接子节点。"""
    for child_element in list(cell_element):
        if child_element.tag in child_tags:
            cell_element.remove(child_element)


def set_cell_number(
    sheet_root: ElementTree.Element,
    cell_map: dict[str, ElementTree.Element],
    cell_reference: str,
    numeric_value: float,
) -> None:
    """把单元格写成纯数字并清理旧公式。"""
    cell_element = ensure_cell(sheet_root, cell_map, cell_reference)
    remove_direct_children(cell_element, {FORMULA_TAG, INLINE_STRING_TAG, VALUE_TAG})
    cell_element.attrib.pop("t", None)
    value_element = ElementTree.Element(VALUE_TAG)
    value_element.text = format_raw_number(numeric_value)
    cell_element.append(value_element)


def set_formula_cached_number(
    sheet_root: ElementTree.Element,
    cell_map: dict[str, ElementTree.Element],
    cell_reference: str,
    numeric_value: float,
) -> None:
    """保留公式并更新公式缓存值。"""
    cell_element = ensure_cell(sheet_root, cell_map, cell_reference)
    formula_element = cell_element.find(FORMULA_TAG)
    if formula_element is None:
        set_cell_number(sheet_root, cell_map, cell_reference, numeric_value)
        return
    remove_direct_children(cell_element, {INLINE_STRING_TAG, VALUE_TAG})
    cell_element.attrib.pop("t", None)
    value_element = ElementTree.Element(VALUE_TAG)
    value_element.text = format_raw_number(numeric_value)
    formula_index = list(cell_element).index(formula_element)
    cell_element.insert(formula_index + 1, value_element)


def format_raw_number(numeric_value: float) -> str:
    """把数字格式化成Excel内部可读的短文本。"""
    rounded_value = round(float(numeric_value or 0), 10)
    if rounded_value == int(rounded_value):
        return str(int(rounded_value))
    return str(rounded_value)


def discover_date_columns(
    cell_map: dict[str, ElementTree.Element],
    report_config: dict[str, Any],
    shared_strings: list[str],
) -> dict[str, Any]:
    """从工作表日期行识别真实存在的日期列。"""
    template_config = report_config.get("template", {})
    first_data_column = int(template_config.get("firstDataColumn", 6))
    date_row_number = int(template_config.get("dateRow", 2))
    date_group_width = int(template_config.get("dateGroupWidth", 0))
    date_columns: list[DateColumnInfo] = []
    date_columns_by_text: dict[str, DateColumnInfo] = {}
    if date_group_width > 0:
        for group_start_column in range(first_data_column, 201, date_group_width):
            raw_date_serial = read_cell_value(
                cell_map,
                build_cell_reference(group_start_column, date_row_number),
                shared_strings,
            )
            date_serial = parse_raw_number(raw_date_serial)
            if date_serial <= 0:
                continue
            date_text = parse_excel_serial_date(date_serial)
            date_column = DateColumnInfo(
                date_text=date_text,
                day_column_number=group_start_column + int(template_config.get("dayColumnOffset", 0)),
                night_column_number=group_start_column + int(template_config.get("nightColumnOffset", 2)),
                summary_column_number=group_start_column + int(template_config.get("summaryColumnOffset", 3)),
                top_daily_column_number=group_start_column + int(template_config.get("topDailyColumnOffset", 0)),
            )
            date_columns.append(date_column)
            date_columns_by_text[date_text] = date_column
    return {"items": date_columns, "by_date": date_columns_by_text}


def parse_product_price(product_name: str) -> float:
    """读取产品名括号里的销售价格。"""
    price_match = re.search(r"（([0-9,.]+)元）", product_name or "")
    return parse_raw_number(price_match.group(1)) if price_match else 0


def is_store_summary_text(raw_text: str) -> bool:
    """判断单元格是否是店铺汇总标识。"""
    normalized_text = str(raw_text or "")
    return "本店" in normalized_text and "汇总" in normalized_text


def discover_summary_groups(
    sheet_root: ElementTree.Element,
    cell_map: dict[str, ElementTree.Element],
    shared_strings: list[str],
    report_config: dict[str, Any],
) -> list[dict[str, Any]]:
    """识别每个运营汇总行下面的产品行。"""
    product_rows = report_config.get("productRows", [])
    if not product_rows:
        return []
    sorted_product_rows = sorted(product_rows, key=lambda item: int(item["row"]))
    product_row_numbers = {int(item["row"]) for item in sorted_product_rows}
    minimum_row_number = min(product_row_numbers)
    maximum_row_number = max(product_row_numbers)
    template_config = report_config.get("template", {})
    operator_column_number = int(template_config.get("operatorColumn", 5))
    summary_label_column_number = int(template_config.get("summaryLabelColumn", 6))
    summary_groups: list[dict[str, Any]] = []
    current_group: dict[str, Any] | None = None
    for row_number in range(max(1, minimum_row_number - 5), maximum_row_number + 1):
        operator_text = read_cell_value(
            cell_map,
            build_cell_reference(operator_column_number, row_number),
            shared_strings,
        )
        summary_text = read_cell_value(
            cell_map,
            build_cell_reference(summary_label_column_number, row_number),
            shared_strings,
        )
        if "运营" in operator_text and is_store_summary_text(summary_text):
            current_group = {"summary_row": row_number, "product_rows": []}
            summary_groups.append(current_group)
            continue
        if row_number in product_row_numbers and current_group is not None:
            current_group["product_rows"].append(row_number)
    return [group for group in summary_groups if group["product_rows"]]


def recalculate_product_totals(
    sheet_root: ElementTree.Element,
    cell_map: dict[str, ElementTree.Element],
    report_config: dict[str, Any],
    date_columns: list[DateColumnInfo],
) -> tuple[float, float]:
    """刷新产品行累计数量和销售额缓存。"""
    template_config = report_config.get("template", {})
    product_total_column = int(template_config.get("productTotalColumn", 3))
    sales_total_column = int(template_config.get("salesTotalColumn", 4))
    total_quantity = 0.0
    total_amount = 0.0
    for product_row in report_config.get("productRows", []):
        row_number = int(product_row["row"])
        row_quantity = sum(
            read_number_cell(cell_map, build_cell_reference(date_column.day_column_number, row_number))
            + read_number_cell(cell_map, build_cell_reference(date_column.night_column_number, row_number))
            for date_column in date_columns
        )
        row_amount = row_quantity * parse_product_price(product_row.get("productName", ""))
        set_formula_cached_number(
            sheet_root,
            cell_map,
            build_cell_reference(product_total_column, row_number),
            row_quantity,
        )
        set_formula_cached_number(
            sheet_root,
            cell_map,
            build_cell_reference(sales_total_column, row_number),
            row_amount,
        )
        total_quantity += row_quantity
        total_amount += row_amount
    return total_quantity, total_amount


def recalculate_summary_rows(
    sheet_root: ElementTree.Element,
    cell_map: dict[str, ElementTree.Element],
    summary_groups: list[dict[str, Any]],
    date_columns: list[DateColumnInfo],
) -> dict[str, float]:
    """刷新店铺汇总行并返回每天总量。"""
    summary_total_by_date: dict[str, float] = {}
    for summary_group in summary_groups:
        summary_row_number = int(summary_group["summary_row"])
        for date_column in date_columns:
            daily_quantity = sum(
                read_number_cell(
                    cell_map,
                    build_cell_reference(date_column.day_column_number, int(product_row_number)),
                )
                + read_number_cell(
                    cell_map,
                    build_cell_reference(date_column.night_column_number, int(product_row_number)),
                )
                for product_row_number in summary_group["product_rows"]
            )
            set_formula_cached_number(
                sheet_root,
                cell_map,
                build_cell_reference(date_column.summary_column_number, summary_row_number),
                daily_quantity,
            )
            summary_total_by_date[date_column.date_text] = (
                summary_total_by_date.get(date_column.date_text, 0) + daily_quantity
            )
    return summary_total_by_date


def recalculate_top_rows(
    sheet_root: ElementTree.Element,
    cell_map: dict[str, ElementTree.Element],
    report_config: dict[str, Any],
    date_columns: list[DateColumnInfo],
    product_total_quantity: float,
    product_total_amount: float,
    summary_total_by_date: dict[str, float],
) -> None:
    """刷新顶部总销量、销售额和每日总量缓存。"""
    template_config = report_config.get("template", {})
    set_formula_cached_number(
        sheet_root,
        cell_map,
        str(template_config.get("topQuantityCell", "D3")),
        product_total_quantity,
    )
    set_formula_cached_number(
        sheet_root,
        cell_map,
        str(template_config.get("topAmountCell", "E3")),
        product_total_amount,
    )
    top_daily_row_number = int(template_config.get("topDailyRow", 3))
    for date_column in date_columns:
        set_formula_cached_number(
            sheet_root,
            cell_map,
            build_cell_reference(date_column.top_daily_column_number, top_daily_row_number),
            summary_total_by_date.get(date_column.date_text, 0),
        )


def write_aggregation_to_sheet(
    sheet_root: ElementTree.Element,
    report_config: dict[str, Any],
    shared_strings: list[str],
    target_dates: list[str],
    aggregation_result: ReportAggregationResult,
) -> MonthWriteResult:
    """把一个月份的聚合结果写入工作表并刷新汇总。"""
    cell_map = build_cell_map(sheet_root)
    date_column_result = discover_date_columns(cell_map, report_config, shared_strings)
    date_columns_by_text: dict[str, DateColumnInfo] = date_column_result["by_date"]
    date_columns: list[DateColumnInfo] = date_column_result["items"]
    missing_dates = [date_text for date_text in target_dates if date_text not in date_columns_by_text]
    if missing_dates:
        raise RuntimeError(f"工作表缺少日期：{'、'.join(missing_dates[:5])}")
    written_quantity = 0.0
    for product_row in report_config.get("productRows", []):
        row_number = int(product_row["row"])
        for date_text in target_dates:
            date_column = date_columns_by_text[date_text]
            shift_quantity = aggregation_result.row_date_shift_quantity.get(row_number, {}).get(
                date_text,
                {"day": 0, "night": 0},
            )
            set_cell_number(
                sheet_root,
                cell_map,
                build_cell_reference(date_column.day_column_number, row_number),
                shift_quantity["day"],
            )
            set_cell_number(
                sheet_root,
                cell_map,
                build_cell_reference(date_column.night_column_number, row_number),
                shift_quantity["night"],
            )
            written_quantity += shift_quantity["day"] + shift_quantity["night"]
    summary_groups = discover_summary_groups(sheet_root, cell_map, shared_strings, report_config)
    product_total_quantity, product_total_amount = recalculate_product_totals(
        sheet_root,
        cell_map,
        report_config,
        date_columns,
    )
    summary_total_by_date = recalculate_summary_rows(
        sheet_root,
        cell_map,
        summary_groups,
        date_columns,
    )
    recalculate_top_rows(
        sheet_root,
        cell_map,
        report_config,
        date_columns,
        product_total_quantity,
        product_total_amount,
        summary_total_by_date,
    )
    return MonthWriteResult(
        sheet_name="",
        target_date_count=len(target_dates),
        written_quantity=written_quantity,
        product_total_quantity=product_total_quantity,
        product_total_amount=product_total_amount,
        summary_group_count=len(summary_groups),
    )


def remove_calculation_artifacts(zip_entries: dict[str, bytes]) -> None:
    """删除旧计算链并要求Excel/WPS打开时重新计算。"""
    zip_entries.pop("xl/calcChain.xml", None)
    workbook_root = ElementTree.fromstring(zip_entries["xl/workbook.xml"])
    calc_pr_tag = qualified_xml_name(MAIN_XML_NAMESPACE, "calcPr")
    calc_pr_element = workbook_root.find(calc_pr_tag)
    if calc_pr_element is None:
        calc_pr_element = ElementTree.Element(calc_pr_tag)
        workbook_root.append(calc_pr_element)
    calc_pr_element.set("calcMode", "auto")
    calc_pr_element.set("fullCalcOnLoad", "1")
    calc_pr_element.set("forceFullCalc", "1")
    zip_entries["xl/workbook.xml"] = serialize_xml_document(workbook_root)


def build_output_workbook_bytes(
    annual_template_path: Path,
    report_config: dict[str, Any],
    aggregation_result: ReportAggregationResult,
    start_date: date,
    end_date: date,
) -> tuple[bytes, list[MonthWriteResult]]:
    """把日期范围写入全年模板并返回完整xlsx字节。"""
    register_xml_namespaces()
    zip_entries = read_zip_entries(annual_template_path)
    sheet_paths_by_name = read_workbook_sheet_paths(zip_entries)
    shared_strings = read_shared_strings(zip_entries)
    target_month_numbers = sorted({current_date.month for current_date in _iter_dates(start_date, end_date)})
    month_write_results: list[MonthWriteResult] = []
    for month_number in target_month_numbers:
        sheet_name = f"{start_date.year}-{month_number}"
        sheet_path = sheet_paths_by_name.get(sheet_name)
        if sheet_path is None or sheet_path not in zip_entries:
            raise RuntimeError(f"全年模板缺少工作表：{sheet_name}")
        target_dates = [
            current_date.isoformat()
            for current_date in _iter_dates(start_date, end_date)
            if current_date.month == month_number
        ]
        sheet_root = ElementTree.fromstring(zip_entries[sheet_path])
        month_write_result = write_aggregation_to_sheet(
            sheet_root,
            report_config,
            shared_strings,
            target_dates,
            aggregation_result,
        )
        month_write_result.sheet_name = sheet_name
        month_write_results.append(month_write_result)
        zip_entries[sheet_path] = serialize_xml_document(sheet_root)
    remove_calculation_artifacts(zip_entries)
    with BytesIO() as output_stream:
        with ZipFile(output_stream, "w", ZIP_DEFLATED) as output_zip:
            for entry_name, entry_bytes in zip_entries.items():
                output_zip.writestr(entry_name, entry_bytes)
        return output_stream.getvalue(), month_write_results


def _iter_dates(start_date: date, end_date: date):
    """遍历日期范围。"""
    current_date = start_date
    while current_date <= end_date:
        yield current_date
        current_date += timedelta(days=1)
