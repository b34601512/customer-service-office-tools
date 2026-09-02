"""该文件只负责把电话系统导出的 .xls 读取成 JSON 安全的行数据。"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import xlrd

from .logging_utils import write_log


def _cell_value(book: xlrd.book.Book, cell: xlrd.sheet.Cell) -> Any:
    """把 xlrd 单元格转成可直接写入 result.json 的值。"""
    if cell.ctype == xlrd.XL_CELL_DATE:
        value = xlrd.xldate_as_datetime(cell.value, book.datemode)
        if 0 <= float(cell.value) < 1:
            return value.strftime("%H:%M:%S")
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if cell.ctype == xlrd.XL_CELL_BOOLEAN:
        return bool(cell.value)
    if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
        return ""
    return cell.value


def read_excel_rows(file_path: Path) -> list[dict[str, Any]]:
    """直接读取老版二进制 .xls，不启动或依赖桌面 Excel 进程。"""
    workbook: xlrd.book.Book | None = None
    try:
        workbook = xlrd.open_workbook(str(Path(file_path).resolve()), on_demand=True)
        worksheet = workbook.sheet_by_index(0)
        if worksheet.nrows == 0:
            return []
        headers = [
            str(_cell_value(workbook, worksheet.cell(0, column_index)) or "").strip()
            or f"未命名列{column_index + 1}"
            for column_index in range(worksheet.ncols)
        ]

        rows: list[dict[str, Any]] = []
        for row_index in range(1, worksheet.nrows):
            row_data: dict[str, Any] = {}
            has_value = False
            for column_index, header_text in enumerate(headers):
                cell_value = _cell_value(workbook, worksheet.cell(row_index, column_index))
                if cell_value not in (None, ""):
                    has_value = True
                row_data[header_text] = cell_value
            if has_value:
                rows.append(row_data)

        write_log("读取文件", "Excel", f"{file_path.name} 行数={len(rows)} 列数={len(headers)}")
        return rows
    finally:
        if workbook is not None:
            workbook.release_resources()
