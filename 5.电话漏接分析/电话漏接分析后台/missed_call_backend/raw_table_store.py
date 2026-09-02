"""原始报表行的唯一存取入口：下载时读取，结果页只读 result.json。"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from .excel_reader import read_excel_rows

RAW_TABLE_FILE_KEYS = {
    "loss": "lossFile",
    "inbound": "inboundFile",
    "outbound": "outboundFile",
}


def read_raw_tables(source_files: Mapping[str, Path]) -> dict[str, list[dict[str, Any]]]:
    """一次读取下载的三张表，键名统一为 loss/inbound/outbound。"""
    return {
        table_key: read_excel_rows(Path(source_files[file_key]))
        for table_key, file_key in RAW_TABLE_FILE_KEYS.items()
    }


def result_raw_tables(result: Mapping[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """读取结果中持久化的原始行；结构不完整时明确失败，不回退到另一真源。"""
    raw_tables = result.get("rawTables")
    if not isinstance(raw_tables, dict):
        raise RuntimeError("当前分析结果缺少原始表数据，请重新下载并分析。")
    output: dict[str, list[dict[str, Any]]] = {}
    for table_key in RAW_TABLE_FILE_KEYS:
        rows = raw_tables.get(table_key)
        if not isinstance(rows, list):
            raise RuntimeError(f"当前分析结果的 {table_key} 原始表结构无效，请重新下载并分析。")
        output[table_key] = rows
    return output
