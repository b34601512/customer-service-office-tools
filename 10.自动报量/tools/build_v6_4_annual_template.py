from __future__ import annotations

import re
import sys
from copy import deepcopy
from datetime import date
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from xml.etree import ElementTree


PROJECT_ROOT = Path(__file__).resolve().parents[1]
HTML_TOOL_DIRECTORY = PROJECT_ROOT / "html导入工具"
SOURCE_TEMPLATE_PATH = HTML_TOOL_DIRECTORY / "2026年智能报量-v6.4.xlsx"
OUTPUT_TEMPLATE_PATH = HTML_TOOL_DIRECTORY / "2026年智能报量-v6.4-全年.xlsx"

MAIN_XML_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELATIONSHIP_XML_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_RELATIONSHIP_XML_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/content-types"

DATE_ROW_NUMBER = 2
FIRST_DATE_COLUMN_NUMBER = 6
DATE_GROUP_WIDTH = 4
DATE_ANCHOR_COLUMNS = {
    FIRST_DATE_COLUMN_NUMBER + index * DATE_GROUP_WIDTH
    for index in range(60)
}

MONTH_DAY_COUNTS = {
    1: 31,
    2: 28,
    3: 31,
    4: 30,
    5: 31,
    6: 30,
    7: 31,
    8: 31,
    9: 30,
    10: 31,
    11: 30,
    12: 31,
}


def qualified_name(namespace: str, local_name: str) -> str:
    """生成带命名空间的XML标签名。"""
    return f"{{{namespace}}}{local_name}"


def parse_column_number(cell_reference: str) -> int:
    """把Excel列名转换为数字列号。"""
    match = re.match(r"^([A-Z]+)(\d+)$", cell_reference or "")
    if not match:
        return 0
    column_number = 0
    for character in match.group(1):
        column_number = column_number * 26 + ord(character) - ord("A") + 1
    return column_number


def parse_row_number(cell_reference: str) -> int:
    """从Excel单元格引用中读取行号。"""
    match = re.match(r"^[A-Z]+(\d+)$", cell_reference or "")
    return int(match.group(1)) if match else 0


def excel_serial_for_date(target_date: date) -> int:
    """把日期转换成Excel 1900日期序列号。"""
    return (target_date - date(1899, 12, 30)).days


def cell_value_node(cell_element: ElementTree.Element) -> ElementTree.Element | None:
    """读取单元格里的数值节点。"""
    return cell_element.find(qualified_name(MAIN_XML_NAMESPACE, "v"))


def read_source_date_serials(sheet_root: ElementTree.Element) -> dict[int, str]:
    """读取v6.4母表31个日期锚点的原始序列号。"""
    source_date_serials: dict[int, str] = {}
    for cell_element in sheet_root.iter(qualified_name(MAIN_XML_NAMESPACE, "c")):
        cell_reference = cell_element.get("r", "")
        if parse_column_number(cell_reference) not in DATE_ANCHOR_COLUMNS:
            continue
        if parse_row_number(cell_reference) != DATE_ROW_NUMBER:
            continue
        value_node = cell_value_node(cell_element)
        if value_node is None or not (value_node.text or "").strip():
            continue
        day_index = (parse_column_number(cell_reference) - FIRST_DATE_COLUMN_NUMBER) // DATE_GROUP_WIDTH + 1
        source_date_serials[day_index] = (value_node.text or "").strip()
    if len(source_date_serials) < 31:
        raise RuntimeError(
            f"v6.4模板日期锚点异常：读取到{len(source_date_serials)}天，至少需要31天。"
        )
    return source_date_serials


def update_sheet_dates(
    sheet_root: ElementTree.Element,
    source_date_serials: dict[int, str],
    target_year: int,
    target_month: int,
) -> None:
    """把母表中的7月日期改成目标月份，并清空不存在的日期。"""
    target_day_count = MONTH_DAY_COUNTS[target_month]
    replacement_by_source_serial: dict[str, str | None] = {}
    for day_index, source_serial in source_date_serials.items():
        replacement_by_source_serial[source_serial] = (
            str(excel_serial_for_date(date(target_year, target_month, day_index)))
            if day_index <= target_day_count
            else None
        )

    for cell_element in sheet_root.iter(qualified_name(MAIN_XML_NAMESPACE, "c")):
        cell_reference = cell_element.get("r", "")
        if parse_column_number(cell_reference) not in DATE_ANCHOR_COLUMNS:
            continue
        value_node = cell_value_node(cell_element)
        if value_node is None:
            continue
        source_serial = (value_node.text or "").strip()
        if source_serial not in replacement_by_source_serial:
            continue
        target_serial = replacement_by_source_serial[source_serial]
        if target_serial is None:
            cell_element.remove(value_node)
            cell_element.attrib.pop("t", None)
        else:
            value_node.text = target_serial


def register_xml_namespaces() -> None:
    """固定常见命名空间前缀，避免生成无意义的ns0前缀。"""
    ElementTree.register_namespace("", MAIN_XML_NAMESPACE)
    ElementTree.register_namespace("r", RELATIONSHIP_XML_NAMESPACE)
    ElementTree.register_namespace("", PACKAGE_RELATIONSHIP_XML_NAMESPACE)
    ElementTree.register_namespace("", CONTENT_TYPES_NAMESPACE)
    ElementTree.register_namespace("dbsheet", "http://web.wps.cn/et/2021/dbsheet")
    ElementTree.register_namespace(
        "xcalcf",
        "http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures",
    )


def serialize_xml(root: ElementTree.Element) -> bytes:
    """把XML树序列化为Excel可读取的UTF-8文档。"""
    return ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)


def get_relationship_target_map(rels_root: ElementTree.Element) -> dict[str, str]:
    """读取工作簿关系ID到目标文件的映射。"""
    relationship_tag = qualified_name(PACKAGE_RELATIONSHIP_XML_NAMESPACE, "Relationship")
    return {
        relationship.get("Id", ""): relationship.get("Target", "")
        for relationship in rels_root.findall(relationship_tag)
    }


def next_relationship_id(rels_root: ElementTree.Element) -> str:
    """生成不与原工作簿冲突的关系ID。"""
    relationship_tag = qualified_name(PACKAGE_RELATIONSHIP_XML_NAMESPACE, "Relationship")
    existing_numbers = []
    for relationship in rels_root.findall(relationship_tag):
        match = re.fullmatch(r"rId(\d+)", relationship.get("Id", ""))
        if match:
            existing_numbers.append(int(match.group(1)))
    return f"rId{max(existing_numbers, default=0) + 1}"


def build_annual_workbook_bytes(source_workbook_path: Path, target_year: int) -> bytes:
    """从v6.4单月母表建立全年工作簿，不改动母表文件。"""
    register_xml_namespaces()
    with ZipFile(source_workbook_path, "r") as source_zip:
        zip_entries = {entry_name: source_zip.read(entry_name) for entry_name in source_zip.namelist()}

    workbook_root = ElementTree.fromstring(zip_entries["xl/workbook.xml"])
    workbook_rels_root = ElementTree.fromstring(zip_entries["xl/_rels/workbook.xml.rels"])
    content_types_root = ElementTree.fromstring(zip_entries["[Content_Types].xml"])
    relationship_targets = get_relationship_target_map(workbook_rels_root)

    sheet_tag = qualified_name(MAIN_XML_NAMESPACE, "sheet")
    sheets_tag = qualified_name(MAIN_XML_NAMESPACE, "sheets")
    sheets_element = workbook_root.find(sheets_tag)
    if sheets_element is None:
        raise RuntimeError("v6.4模板缺少工作表集合。")
    source_sheet_elements = sheets_element.findall(sheet_tag)
    if len(source_sheet_elements) != 1:
        raise RuntimeError(f"v6.4模板工作表数量异常：{len(source_sheet_elements)}，预期1张。")

    source_sheet_element = source_sheet_elements[0]
    source_relationship_id = source_sheet_element.get(
        qualified_name(RELATIONSHIP_XML_NAMESPACE, "id"),
        "",
    )
    source_sheet_target = relationship_targets.get(source_relationship_id, "")
    if not source_sheet_target:
        raise RuntimeError("v6.4模板找不到首张工作表关系。")
    source_sheet_path = f"xl/{source_sheet_target.lstrip('/')}"
    source_sheet_root = ElementTree.fromstring(zip_entries[source_sheet_path])
    source_date_serials = read_source_date_serials(source_sheet_root)

    sheets_element.remove(source_sheet_element)
    rel_id_attribute = qualified_name(RELATIONSHIP_XML_NAMESPACE, "id")
    content_override_tag = qualified_name(CONTENT_TYPES_NAMESPACE, "Override")
    sheet_content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
    for month in range(1, 13):
        sheet_number = month
        relationship_id = source_relationship_id if month == 1 else next_relationship_id(workbook_rels_root)
        target_sheet_path = f"xl/worksheets/sheet{sheet_number}.xml"
        target_sheet_root = deepcopy(source_sheet_root)
        update_sheet_dates(target_sheet_root, source_date_serials, target_year, month)
        zip_entries[target_sheet_path] = serialize_xml(target_sheet_root)

        sheet_element = ElementTree.Element(
            sheet_tag,
            {
                "name": f"{target_year}-{month}",
                "sheetId": str(sheet_number),
                rel_id_attribute: relationship_id,
            },
        )
        sheets_element.append(sheet_element)
        if month != 1:
            relationship_element = ElementTree.Element(
                qualified_name(PACKAGE_RELATIONSHIP_XML_NAMESPACE, "Relationship"),
                {
                    "Id": relationship_id,
                    "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
                    "Target": f"worksheets/sheet{sheet_number}.xml",
                },
            )
            workbook_rels_root.append(relationship_element)
        if not any(
            override.get("PartName") == f"/xl/worksheets/sheet{sheet_number}.xml"
            for override in content_types_root.findall(content_override_tag)
        ):
            content_types_root.append(
                ElementTree.Element(
                    content_override_tag,
                    {
                        "PartName": f"/xl/worksheets/sheet{sheet_number}.xml",
                        "ContentType": sheet_content_type,
                    },
                )
            )

    zip_entries["xl/workbook.xml"] = serialize_xml(workbook_root)
    zip_entries["xl/_rels/workbook.xml.rels"] = serialize_xml(workbook_rels_root)
    zip_entries["[Content_Types].xml"] = serialize_xml(content_types_root)

    output_buffer = bytearray()
    from io import BytesIO

    with BytesIO() as output_stream:
        with ZipFile(output_stream, "w", ZIP_DEFLATED) as output_zip:
            for entry_name, entry_bytes in zip_entries.items():
                output_zip.writestr(entry_name, entry_bytes)
        output_buffer.extend(output_stream.getvalue())
    return bytes(output_buffer)


def write_annual_template(output_path: Path, target_year: int) -> None:
    """生成全年模板文件。"""
    if not SOURCE_TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"找不到v6.4母表：{SOURCE_TEMPLATE_PATH}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(build_annual_workbook_bytes(SOURCE_TEMPLATE_PATH, target_year))


def main() -> int:
    """执行全年模板生成入口。"""
    target_year = 2026
    if len(sys.argv) > 1:
        target_year = int(sys.argv[1])
    if target_year != 2026:
        raise ValueError("当前v6.4映射和母表属于2026年度，只允许生成2026全年模板。")
    if OUTPUT_TEMPLATE_PATH.exists():
        print(f"全年模板已存在，未覆盖：{OUTPUT_TEMPLATE_PATH}")
        return 0
    write_annual_template(OUTPUT_TEMPLATE_PATH, target_year)
    print(f"全年模板已生成：{OUTPUT_TEMPLATE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
