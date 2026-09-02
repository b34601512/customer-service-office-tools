#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

SHEET_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
CELL_REF_RE = re.compile(r"^([A-Z]+)(\d+)$")


def read_exported_order_workbook(path: str | Path) -> dict[str, Any]:
    # 该函数用于读取 ERP 导出的订单查询表，后续只基于文件判定，不再逐行点击 ERP。
    workbook_path = Path(path)
    if not workbook_path.exists():
        raise RuntimeError(f"读取导出订单失败：未找到文件 {workbook_path}")
    with zipfile.ZipFile(workbook_path) as archive:
        sheet_path = _first_sheet_path(archive)
        shared_strings = _read_shared_strings(archive)
        headers, rows = _read_sheet_rows(archive, sheet_path, shared_strings)
    if not headers:
        raise RuntimeError(f"读取导出订单失败：{workbook_path.name} 没有表头")
    return {
        "source": f"xlsx:{workbook_path.name}",
        "headers": headers,
        "rows": rows,
        "export_file_path": str(workbook_path),
    }


def _first_sheet_path(archive: zipfile.ZipFile) -> str:
    # 该函数用于定位第一个工作表 XML，兼容 ERP 导出只有一个 sheet 的结构。
    try:
        workbook_xml = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        rels_xml = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    except KeyError as exc:
        raise RuntimeError(f"读取导出订单失败：xlsx 缺少内部文件 {exc}") from exc
    relationships = {
        item.attrib.get("Id", ""): item.attrib.get("Target", "")
        for item in rels_xml.findall("r:Relationship", REL_NS)
    }
    first_sheet = workbook_xml.find("m:sheets/m:sheet", SHEET_NS)
    if first_sheet is None:
        raise RuntimeError("读取导出订单失败：xlsx 没有工作表")
    rel_id = first_sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "")
    target = relationships.get(rel_id)
    if not target:
        return "xl/worksheets/sheet1.xml"
    target = target.replace("\\", "/").lstrip("/")
    return target if target.startswith("xl/") else f"xl/{target}"


def _read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    # 该函数用于读取共享字符串表，ERP 导出的中文字段和值通常都在这里。
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    out: list[str] = []
    for item in root.findall("m:si", SHEET_NS):
        parts = [node.text or "" for node in item.findall(".//m:t", SHEET_NS)]
        out.append("".join(parts))
    return out


def _read_sheet_rows(archive: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> tuple[list[str], list[list[str]]]:
    # 该函数把工作表 XML 转成表头和数据行，保留空单元格位置避免列错位。
    root = ElementTree.fromstring(archive.read(sheet_path))
    rows: list[list[str]] = []
    for row_node in root.findall(".//m:sheetData/m:row", SHEET_NS):
        values: dict[int, str] = {}
        for cell in row_node.findall("m:c", SHEET_NS):
            ref = str(cell.attrib.get("r") or "")
            index = _column_index_from_cell_ref(ref)
            if index < 0:
                continue
            values[index] = _cell_text(cell, shared_strings)
        if not values:
            rows.append([])
            continue
        width = max(values) + 1
        rows.append([values.get(index, "") for index in range(width)])
    while rows and not any(str(item or "").strip() for item in rows[-1]):
        rows.pop()
    if not rows:
        return [], []
    headers = [_clean_cell_text(item) for item in rows[0]]
    width = len(headers)
    data_rows = []
    for row in rows[1:]:
        aligned = (row + [""] * width)[:width]
        if any(_clean_cell_text(item) for item in aligned):
            data_rows.append([_clean_cell_text(item) for item in aligned])
    return headers, data_rows


def _cell_text(cell: ElementTree.Element, shared_strings: list[str]) -> str:
    # 该函数按 xlsx 单元格类型读取文本，避免日期和订单号被错误转成数字。
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        return _clean_cell_text("".join(node.text or "" for node in cell.findall(".//m:t", SHEET_NS)))
    value_node = cell.find("m:v", SHEET_NS)
    raw = value_node.text if value_node is not None else ""
    if cell_type == "s":
        try:
            return _clean_cell_text(shared_strings[int(raw)])
        except Exception as exc:
            raise RuntimeError(f"读取导出订单失败：共享字符串索引无效 {raw!r}") from exc
    return _clean_cell_text(raw)


def _column_index_from_cell_ref(value: str) -> int:
    # 该函数把 Excel 列字母转成从 0 开始的列号，用于对齐稀疏单元格。
    match = CELL_REF_RE.match(str(value or ""))
    if not match:
        return -1
    number = 0
    for char in match.group(1):
        number = number * 26 + (ord(char) - ord("A") + 1)
    return number - 1


def _clean_cell_text(value: Any) -> str:
    # 该函数统一清洗导出表里的多余空白，保留订单号中的横线。
    return re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()


__all__ = ["read_exported_order_workbook"]
