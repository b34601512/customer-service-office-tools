#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest
import tempfile
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from refund_reminder.config import default_config
from refund_reminder.exported_order_workbook import read_exported_order_workbook
from refund_reminder.order_detector import detect_problem_orders_from_exported_rows, is_valid_platform_order_text, normalize_header


def _config_for_date(payment_date: str = "2026-04-27"):
    # 该函数保留旧测试入口名，当前检测配置不再按日期过滤。
    return default_config().detection


def _payload(rows: list[list[str]]) -> dict:
    # 该函数模拟 ERP 导出的订单查询表，主流程只看导出表不再读取操作日志。
    return {
        "source": "unit-xlsx",
        "headers": ["平台单号", "订单编号", "店铺", "订单来源", "配货状态", "发货状态", "审核", "平台交易状态", "支付金额", "支付日期", "退款", "退款状态"],
        "rows": rows,
    }


def _write_minimal_xlsx(path: Path, headers: list[str], rows: list[list[str]]) -> None:
    # 该函数生成临时 xlsx 样例，避免测试读取会被真实监控覆盖的固定运行文件。
    sheet_rows = [headers, *rows]
    row_xml = []
    for row_index, row in enumerate(sheet_rows, start=1):
        cells = []
        for column_index, value in enumerate(row):
            ref = f"{_xlsx_column_name(column_index)}{row_index}"
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
        row_xml.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        archive.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{"".join(row_xml)}</sheetData></worksheet>')


def _xlsx_column_name(index: int) -> str:
    # 该函数把从0开始的列号转成 Excel 列名。
    number = int(index) + 1
    chars = []
    while number:
        number, remainder = divmod(number - 1, 26)
        chars.append(chr(ord("A") + remainder))
    return "".join(reversed(chars))


class OrderDetectorTest(unittest.TestCase):
    def test_exported_order_detection_uses_refund_evidence_and_platform_order(self) -> None:
        config = _config_for_date()
        payload = _payload([["P001", "SO001", "测试店", "拼多多", "全部配货", "全部发货", "审核成功", "交易成功", "598.00", "2026-04-27 10:00:00", "√", ""]])

        result = detect_problem_orders_from_exported_rows(payload, config)

        self.assertEqual(result.total_rows, 1)
        self.assertEqual(len(result.problem_orders), 1)
        self.assertEqual(result.problem_orders[0].row["平台单号"], "P001")
        self.assertEqual(result.problem_orders[0].payment_time_text, "2026-04-27 10:00:00")
        self.assertEqual(result.problem_orders[0].refund_status_text, "√")
        self.assertEqual(result.row_debugs[0].reason, "命中：导出退款订单，进入页面并按配置付款范围提醒")

    def test_exported_order_detection_collects_other_payment_dates(self) -> None:
        config = _config_for_date()
        payload = _payload([["P001", "SO001", "测试店", "拼多多", "", "", "", "", "", "2026-04-26 10:00:00", "√", ""]])

        result = detect_problem_orders_from_exported_rows(payload, config)

        self.assertEqual(len(result.problem_orders), 1)
        self.assertEqual(result.problem_orders[0].payment_time_text, "2026-04-26 10:00:00")

    def test_exported_order_detection_skips_rows_without_refund_evidence(self) -> None:
        config = _config_for_date()
        payload = _payload([["P001", "SO001", "测试店", "拼多多", "", "", "", "", "", "2026-04-27 10:00:00", "", ""]])

        result = detect_problem_orders_from_exported_rows(payload, config)

        self.assertEqual(len(result.problem_orders), 0)
        self.assertIn("缺少退款证据", result.row_debugs[0].reason)

    def test_exported_order_detection_requires_valid_platform_order(self) -> None:
        config = _config_for_date()
        payload = _payload([["$CpUjQHD9WXFFt3O+QVzGlA==$1$", "SO001", "测试店", "拼多多", "", "", "", "", "", "2026-04-27 10:00:00", "√", ""]])

        result = detect_problem_orders_from_exported_rows(payload, config)

        self.assertEqual(len(result.problem_orders), 0)
        self.assertIn("平台单号为空或非法", result.row_debugs[0].reason)

    def test_exported_order_detection_reports_missing_payment_column(self) -> None:
        config = _config_for_date()
        payload = {"source": "unit-xlsx", "headers": ["平台单号", "退款"], "rows": [["P001", "√"]]}

        with self.assertRaisesRegex(RuntimeError, "找不到支付日期列"):
            detect_problem_orders_from_exported_rows(payload, config)

    def test_sample_workbook_can_be_read_and_collected(self) -> None:
        config = _config_for_date("2026-06-16")
        with tempfile.TemporaryDirectory() as tmp:
            workbook_path = Path(tmp) / "订单查询.xlsx"
            _write_minimal_xlsx(
                workbook_path,
                ["平台单号", "订单编号", "店铺", "支付日期", "退款"],
                [
                    ["P001", "SO001", "测试店", "2026-06-16 10:00:00", "√"],
                    ["P002", "SO002", "测试店", "2026-06-15 10:00:00", "√"],
                ],
            )
            payload = read_exported_order_workbook(workbook_path)

        result = detect_problem_orders_from_exported_rows(payload, config)

        self.assertEqual(result.total_rows, 2)
        self.assertEqual(len(result.problem_orders), 2)
        self.assertIn("支付日期", result.headers)
        self.assertEqual([order.row["平台单号"] for order in result.problem_orders], ["P001", "P002"])

    def test_normalize_header_removes_spaces_and_colons(self) -> None:
        self.assertEqual(normalize_header(" 操作 日期："), "操作日期")

    def test_platform_order_validation_rejects_page_internal_values(self) -> None:
        self.assertTrue(is_valid_platform_order_text("P001"))
        self.assertTrue(is_valid_platform_order_text("260615-086371285323072"))
        self.assertFalse(is_valid_platform_order_text("setting"))
        self.assertFalse(is_valid_platform_order_text("$CpUjQHD9WXFFt3O+QVzGlA==$1$"))


if __name__ == "__main__":
    unittest.main()
