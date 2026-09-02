from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import xlrd

from missed_call_backend import excel_reader, result_cache
from missed_call_backend.cli_app import CliApplication
from missed_call_backend.cli_data import load_cached_call_records
from missed_call_backend.paths import ANALYSIS_SCHEMA_VERSION


class _FakeCell:
    def __init__(self, cell_type: int, value: object) -> None:
        self.ctype = cell_type
        self.value = value


class _FakeSheet:
    def __init__(self, rows: list[list[_FakeCell]]) -> None:
        self._rows = rows
        self.nrows = len(rows)
        self.ncols = len(rows[0])

    def cell(self, row_index: int, column_index: int) -> _FakeCell:
        return self._rows[row_index][column_index]


class _FakeBook:
    datemode = 0

    def __init__(self, sheet: _FakeSheet) -> None:
        self._sheet = sheet
        self.released = False

    def sheet_by_index(self, index: int) -> _FakeSheet:
        if index != 0:
            raise IndexError(index)
        return self._sheet

    def release_resources(self) -> None:
        self.released = True


class ExcelReaderTest(unittest.TestCase):
    def test_xls_reader_returns_json_safe_rows_without_desktop_excel(self) -> None:
        book = _FakeBook(
            _FakeSheet(
                [
                    [_FakeCell(xlrd.XL_CELL_TEXT, "来电时间"), _FakeCell(xlrd.XL_CELL_TEXT, "来电号码")],
                    [_FakeCell(xlrd.XL_CELL_TEXT, "2026-08-31 10:00:00"), _FakeCell(xlrd.XL_CELL_TEXT, "13800138000")],
                    [_FakeCell(xlrd.XL_CELL_EMPTY, ""), _FakeCell(xlrd.XL_CELL_EMPTY, "")],
                ]
            )
        )

        with patch.object(excel_reader.xlrd, "open_workbook", return_value=book), patch.object(
            excel_reader, "write_log", lambda *_args: None
        ):
            rows = excel_reader.read_excel_rows(Path("report.xls"))

        self.assertEqual(rows, [{"来电时间": "2026-08-31 10:00:00", "来电号码": "13800138000"}])
        self.assertTrue(book.released)
        source = Path(excel_reader.__file__).read_text(encoding="utf-8")
        self.assertNotIn("win32com", source)
        self.assertNotIn("pythoncom", source)


class UnifiedRawTableResultTest(unittest.TestCase):
    def test_pages_and_agent_records_share_result_raw_rows(self) -> None:
        raw_tables = {
            "loss": [
                {
                    "来电时间": "2026-08-31 09:00:00",
                    "来电号码": "13800138000",
                    "IVR停留": "00:00:02",
                    "排队停留": "00:00:03",
                }
            ],
            "inbound": [
                {
                    "呼入时间": "2026-08-31 09:05:00",
                    "主叫号码": "13800138000",
                    "通话时长": "00:01:00",
                }
            ],
            "outbound": [
                {
                    "呼出时间": "2026-08-31 09:10:00",
                    "被叫号码": "13800138000",
                    "通话时长": "00:00:30",
                }
            ],
        }
        result = {"rawTables": raw_tables}
        application = CliApplication()
        application.latest_result = result

        self.assertIs(application.load_raw_table("loss"), raw_tables["loss"])
        records = load_cached_call_records(result)
        self.assertEqual(len(records.loss_records), 1)
        self.assertEqual(len(records.inbound_records), 1)
        self.assertEqual(len(records.outbound_records), 1)


class RawTableCacheUpgradeTest(unittest.TestCase):
    def test_old_result_is_upgraded_once_with_persisted_raw_tables(self) -> None:
        raw_tables = {"loss": [], "inbound": [], "outbound": []}
        with tempfile.TemporaryDirectory() as temp_dir:
            record_dir = Path(temp_dir)
            cached_files = {}
            for file_key in ("lossFile", "inboundFile", "outboundFile"):
                path = record_dir / f"{file_key}.xls"
                path.write_bytes(b"test")
                cached_files[file_key] = str(path)
            cached_result = {
                "analysisSchemaVersion": ANALYSIS_SCHEMA_VERSION - 1,
                "complaints": {"receiverPhones": ["13800000000"]},
                "latestRecord": {"cachedFiles": cached_files},
                "downloadedFiles": {},
            }
            payload = {"recordDir": str(record_dir)}

            with patch.object(
                result_cache,
                "load_complaint_config",
                return_value={"receiverPhones": ["13800000000"], "receiverPhone": "13800000000"},
            ), patch.object(result_cache, "read_raw_tables", return_value=raw_tables) as mocked_read, patch.object(
                result_cache,
                "analyze_raw_tables",
                return_value={"complaints": {"receiverPhones": ["13800000000"]}},
            ):
                rebuilt = result_cache.rebuild_result_from_cached_files(payload, cached_result)

        mocked_read.assert_called_once()
        self.assertEqual(rebuilt["analysisSchemaVersion"], ANALYSIS_SCHEMA_VERSION)
        self.assertIs(rebuilt["rawTables"], raw_tables)


if __name__ == "__main__":
    unittest.main()
