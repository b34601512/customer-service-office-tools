from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any


SUPPORTED_CSV_ENCODINGS = ("gb18030", "utf-8-sig", "utf-8")


def decode_order_csv_bytes(csv_bytes: bytes) -> tuple[str, str]:
    """识别订单CSV编码并返回文本。"""
    for encoding_name in SUPPORTED_CSV_ENCODINGS:
        try:
            csv_text = csv_bytes.decode(encoding_name)
        except UnicodeDecodeError:
            continue
        if "店铺名称" in csv_text and "付款时间" in csv_text:
            return csv_text, encoding_name
    raise RuntimeError("无法识别订单CSV编码，请确认文件是订单商品明细统计.csv。")


def read_order_csv_records(order_csv_path: Path, report_config: dict[str, Any]) -> tuple[list[dict[str, str]], str]:
    """读取订单CSV并校验报量所需字段。"""
    csv_text, encoding_name = decode_order_csv_bytes(order_csv_path.read_bytes())
    records = list(csv.DictReader(io.StringIO(csv_text)))
    if not records:
        raise RuntimeError("订单CSV没有可处理的数据行。")
    required_headers = list(report_config.get("sourceColumns", {}).values())
    available_headers = set(records[0].keys())
    missing_headers = [header for header in required_headers if header not in available_headers]
    if missing_headers:
        raise RuntimeError(f"订单CSV缺少字段：{'、'.join(missing_headers)}。")
    return records, encoding_name
