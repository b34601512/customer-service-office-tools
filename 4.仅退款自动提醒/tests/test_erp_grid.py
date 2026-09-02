#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from refund_reminder.config import default_config
from refund_reminder.erp_grid import export_current_order_page


class FakeDownload:
    def save_as(self, path: str) -> None:
        # 该函数模拟 Playwright 下载落盘，验证程序会覆盖固定文件名。
        Path(path).write_text("downloaded workbook", encoding="utf-8")


class FakeDownloadInfo:
    def __enter__(self):
        # 该函数模拟 page.expect_download 上下文对象。
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    @property
    def value(self) -> FakeDownload:
        # 该属性模拟 Playwright 在点击导出后返回下载对象。
        return FakeDownload()


class FakeFrame:
    def __init__(self, *, select_clicked: bool = True, export_clicked: bool = True) -> None:
        # 该对象按脚本内容分别模拟全选和导出按钮。
        self.select_clicked = select_clicked
        self.export_clicked = export_clicked

    def evaluate(self, script: str):
        # 该函数让导出测试不依赖真实浏览器 DOM。
        if "导出当前页" in script:
            return {"clicked": self.export_clicked, "source": "export-current-page", "candidate_count": 1 if self.export_clicked else 0}
        return {"clicked": self.select_clicked, "source": "header-checkbox", "candidate_count": 1 if self.select_clicked else 0}


class FakePage:
    def __init__(self, frame: FakeFrame) -> None:
        # 该对象模拟 Playwright Page 的最小下载接口。
        self.frames = [frame]

    def expect_download(self, timeout: int):
        # 该函数用于验证导出动作通过下载通道保存，不触发系统覆盖弹窗。
        self.timeout = timeout
        return FakeDownloadInfo()


class ErpGridExportTest(unittest.TestCase):
    def test_export_current_order_page_replaces_fixed_workbook_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "订单查询.xlsx"
            output_path.write_text("old workbook", encoding="utf-8")
            statuses: list[str] = []

            result = export_current_order_page(FakePage(FakeFrame()), default_config(), output_path, status=statuses.append)

            self.assertEqual(result, output_path)
            self.assertEqual(output_path.read_text(encoding="utf-8"), "downloaded workbook")
            self.assertTrue(any("全选当前页订单：成功" in item for item in statuses))
            self.assertTrue(any("当前页订单已导出" in item for item in statuses))

    def test_export_current_order_page_requires_select_all(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "订单查询.xlsx"

            with self.assertRaisesRegex(RuntimeError, "未找到订单表头全选控件"):
                export_current_order_page(FakePage(FakeFrame(select_clicked=False)), default_config(), output_path)


if __name__ == "__main__":
    unittest.main()
