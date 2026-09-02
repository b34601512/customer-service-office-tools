from __future__ import annotations

import unittest
from datetime import date, datetime
from io import StringIO
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

from missed_call_backend.cli_app import CliApplication
from missed_call_backend import cli_display
from missed_call_backend.cli_data import (
    CachedCallRecords,
    build_daily_trend_rows,
    build_period_call_summary,
    date_range_label,
    earliest_result_day,
    filter_cached_records,
    filter_cached_records_by_dates,
    filter_trend_rows_by_dates,
    previous_calendar_month_range,
    range_label,
    result_day_bounds,
)
from missed_call_backend.cli_display import (
    build_daily_trend_table_rows,
    build_table_lines,
    clear_screen,
    display_width,
    fit_text,
    render_bar,
    shorten_text,
    strip_ansi,
    truncate_text,
)
from missed_call_backend.cli_input import DEFAULT_LONG_LIST_PAGE_SIZE, paged_rows
from missed_call_backend.cli_trend_range import TimeRangeSelection, prompt_time_range_selection, show_period_summary


class CliDisplayTest(unittest.TestCase):
    def test_clear_screen_clears_windows_screen_and_scroll_history(self) -> None:
        terminal_output = Mock()
        terminal_output.isatty.return_value = True

        with patch.object(cli_display.sys, "stdout", terminal_output), patch.object(cli_display.os, "name", "nt"), patch.object(cli_display.os, "system") as mocked_system:
            clear_screen()

        mocked_system.assert_called_once_with("cls")
        self.assertEqual(terminal_output.write.call_args_list[0].args, ("\033[3J\033[2J\033[H",))
        terminal_output.flush.assert_called_once_with()

    def test_clear_screen_does_not_write_control_codes_when_output_is_redirected(self) -> None:
        terminal_output = Mock()
        terminal_output.isatty.return_value = False

        with patch.object(cli_display.sys, "stdout", terminal_output), patch.object(cli_display.os, "system") as mocked_system:
            clear_screen()

        mocked_system.assert_not_called()
        terminal_output.write.assert_not_called()

    def test_daily_table_and_bar_show_comparable_values(self) -> None:
        table_rows = build_daily_trend_table_rows(
            [{"date": "2026-08-03", "value": 10, "change": "↑5（+100.0%）"}],
            include_rate=False,
        )
        bar = render_bar(5, 10, width=10)

        self.assertEqual(table_rows[0][1], 10)
        self.assertEqual(table_rows[0][2].count("█"), 24)
        self.assertEqual(bar.count("█"), 5)

    def test_daily_table_can_show_ivr_and_queue_loss_detail_columns(self) -> None:
        daily_rows = build_daily_trend_rows(
            [
                {"date": "2026-08-13", "lossCount": 15, "ivrLossCount": 12, "queueLossCount": 3, "lossRate": 35.7},
                {"date": "2026-08-14", "lossCount": 8, "ivrLossCount": 8, "queueLossCount": 0, "lossRate": 42.1},
            ],
            "lossCount",
            "lossRate",
            detail_value_keys=("ivrLossCount", "queueLossCount"),
        )
        self.assertEqual([row["ivrLossCount"] for row in daily_rows], [12, 8])
        self.assertEqual([row["queueLossCount"] for row in daily_rows], [3, 0])

        table_rows = build_daily_trend_table_rows(
            daily_rows,
            detail_value_keys=("ivrLossCount", "queueLossCount"),
        )
        self.assertEqual(table_rows[0], ["2026-08-13", 15, 12, 3, table_rows[0][4], "—", "35.7%"])
        self.assertEqual(table_rows[1], ["2026-08-14", 8, 8, 0, table_rows[1][4], "↓7（-46.7%）", "42.1%"])
        self.assertEqual(table_rows[1][4].count("█"), 13)

    def test_shorten_text_keeps_zero_visible(self) -> None:
        self.assertEqual(shorten_text(0), "0")

    def test_visible_graphemes_are_counted_and_truncated_as_whole_units(self) -> None:
        self.assertEqual(display_width("e\u0301"), 1)
        self.assertEqual(display_width("👍🏽"), 2)
        self.assertEqual(display_width("👩🏽‍💻"), 2)
        self.assertEqual(display_width("…—→"), 3)
        self.assertEqual(display_width("\033[31m客户\033[0m"), 4)
        self.assertEqual(strip_ansi(truncate_text("👩🏽‍💻ABC", 3)), "👩🏽‍💻…")

        fitted = fit_text("\033[31m👩🏽‍💻e\u0301客户XYZ\033[0m", 8)
        self.assertEqual(display_width(fitted), 8)
        self.assertIn("\033[0m…", fitted)

    def test_special_nicknames_keep_table_separators_aligned(self) -> None:
        lines = build_table_lines(
            ["客户", "状态"],
            [["👩🏽‍💻e\u0301", "处理中"], ["普通客户", "完成"]],
        )

        def separator_positions(line: str) -> list[int]:
            visible = strip_ansi(line)
            return [display_width(visible[:index]) for index, character in enumerate(visible) if character == "|"]

        self.assertEqual(separator_positions(lines[0]), separator_positions(lines[2]))
        self.assertEqual(separator_positions(lines[2]), separator_positions(lines[3]))


class CliRangeTest(unittest.TestCase):
    def test_daily_trend_rows_show_values_and_day_changes(self) -> None:
        rows = build_daily_trend_rows(
            [
                {"date": "2026-08-01", "lossCount": 10, "totalContactCount": 20},
                {"date": "2026-08-02", "lossCount": 15, "totalContactCount": 30},
                {"date": "2026-08-03", "lossCount": 15, "totalContactCount": 25},
            ],
            "lossCount",
            denominator_key="totalContactCount",
        )

        self.assertEqual([row["value"] for row in rows], [10, 15, 15])
        self.assertEqual([row["change"] for row in rows], ["—", "↑5（+50.0%）", "→0（0.0%）"])
        self.assertEqual([row["rate"] for row in rows], [50.0, 50.0, 60.0])
        self.assertEqual(build_daily_trend_rows([{"name": "2026-08-03", "value": 4}], "value")[0]["date"], "2026-08-03")

    def test_range_label_uses_latest_data_day(self) -> None:
        self.assertEqual(
            range_label(7, date(2026, 8, 3)),
            "2026-07-28 至 2026-08-03（近7天）",
        )

    def test_all_range_label_uses_actual_data_bounds(self) -> None:
        self.assertEqual(
            range_label(0, date(2026, 8, 3), date(2026, 5, 6)),
            "2026-05-06 至 2026-08-03（全部）",
        )

    def test_previous_calendar_month_handles_year_and_month_lengths(self) -> None:
        self.assertEqual(
            previous_calendar_month_range(date(2026, 8, 3)),
            (date(2026, 7, 1), date(2026, 7, 31)),
        )
        self.assertEqual(
            previous_calendar_month_range(date(2026, 1, 10)),
            (date(2025, 12, 1), date(2025, 12, 31)),
        )
        self.assertEqual(
            previous_calendar_month_range(date(2028, 3, 10)),
            (date(2028, 2, 1), date(2028, 2, 29)),
        )

    def test_result_day_bounds_and_range_label_are_explicit(self) -> None:
        result = {
            "charts": {
                "trendSummary": {
                    "rows": [
                        {"date": "2026-08-03"},
                        {"date": "2026-05-06"},
                    ]
                }
            }
        }

        self.assertEqual(result_day_bounds(result), (date(2026, 5, 6), date(2026, 8, 3)))
        self.assertEqual(earliest_result_day(result), date(2026, 5, 6))
        self.assertEqual(date_range_label(date(2026, 7, 1), date(2026, 7, 31), "上个月"), "2026-07-01 至 2026-07-31（上个月）")

    def test_time_range_menu_has_last_month_and_returns_explicit_dates(self) -> None:
        output = StringIO()
        result = {
            "charts": {
                "trendSummary": {
                    "rows": [
                        {"date": "2026-07-01"},
                        {"date": "2026-08-03"},
                    ]
                }
            }
        }

        with patch("builtins.input", return_value="5"), patch(
            "missed_call_backend.cli_trend_range.previous_calendar_month_range",
            return_value=(date(2026, 7, 1), date(2026, 7, 31)),
        ), redirect_stdout(output):
            selection = prompt_time_range_selection(result)

        self.assertEqual(selection.start_day, date(2026, 7, 1))
        self.assertEqual(selection.end_day, date(2026, 7, 31))
        self.assertEqual(selection.label, "2026-07-01 至 2026-07-31（上个月）")
        self.assertIn("上个月", output.getvalue())

    def test_filter_cached_records_uses_one_shared_range(self) -> None:
        records = CachedCallRecords(
            loss_records=[
                {"loss_time": datetime(2026, 8, 3, 9, 0)},
                {"loss_time": datetime(2026, 7, 27, 9, 0)},
            ],
            inbound_records=[
                {"inbound_time": datetime(2026, 7, 28, 9, 0)},
                {"inbound_time": datetime(2026, 7, 20, 9, 0)},
            ],
            outbound_records=[
                {"outbound_time": datetime(2026, 8, 2, 9, 0)},
                {"outbound_time": datetime(2026, 7, 26, 9, 0)},
            ],
        )

        filtered = filter_cached_records(records, 7, date(2026, 8, 3))

        self.assertEqual(len(filtered.loss_records), 1)
        self.assertEqual(len(filtered.inbound_records), 1)
        self.assertEqual(len(filtered.outbound_records), 1)

    def test_custom_trend_range_includes_both_endpoints(self) -> None:
        result = {
            "charts": {
                "trendSummary": {
                    "rows": [
                        {"date": "2026-06-30", "inboundCount": 1},
                        {"date": "2026-07-01", "inboundCount": 2},
                        {"date": "2026-07-31", "inboundCount": 3},
                        {"date": "2026-08-01", "inboundCount": 4},
                    ]
                }
            }
        }

        filtered = filter_trend_rows_by_dates(result, date(2026, 7, 1), date(2026, 7, 31))

        self.assertEqual([row["date"] for row in filtered], ["2026-07-01", "2026-07-31"])

    def test_custom_period_summary_counts_inbound_and_outbound_success(self) -> None:
        records = CachedCallRecords(
            loss_records=[],
            inbound_records=[
                {"inbound_time": datetime(2026, 7, 1, 9, 0), "talk_seconds": 0},
                {"inbound_time": datetime(2026, 7, 31, 18, 0), "talk_seconds": 20},
                {"inbound_time": datetime(2026, 8, 1, 9, 0), "talk_seconds": 10},
            ],
            outbound_records=[
                {"outbound_time": datetime(2026, 7, 1, 10, 0), "talk_seconds": 0},
                {"outbound_time": datetime(2026, 7, 31, 19, 0), "talk_seconds": 30},
                {"outbound_time": datetime(2026, 8, 1, 10, 0), "talk_seconds": 20},
            ],
        )

        filtered = filter_cached_records_by_dates(records, date(2026, 7, 1), date(2026, 7, 31))

        self.assertEqual(
            build_period_call_summary(filtered),
            {
                "inboundCount": 2,
                "successfulInboundCount": 1,
                "inboundSuccessRate": 50.0,
                "outboundCount": 2,
                "successfulOutboundCount": 1,
                "outboundSuccessRate": 50.0,
            },
        )


class CliPaginationTest(unittest.TestCase):
    def test_long_list_uses_fixed_page_size_without_page_size_prompt(self) -> None:
        output = StringIO()
        rows = [[index] for index in range(26)]

        with patch("builtins.input", return_value="") as mocked_input, redirect_stdout(output):
            paged_rows(["编号"], rows)

        rendered = output.getvalue()
        self.assertEqual(DEFAULT_LONG_LIST_PAGE_SIZE, 25)
        self.assertIn("第 1/2 页，共 26 条", rendered)
        mocked_input.assert_called_once_with("输入 n 下一页、p 上一页、页码跳转，回车返回：")
        self.assertNotIn("每页条数", rendered)


class CliPeriodSummaryTest(unittest.TestCase):
    def test_period_summary_is_separate_from_daily_trend_output(self) -> None:
        records = CachedCallRecords(
            loss_records=[],
            inbound_records=[{"inbound_time": datetime(2026, 7, 1, 9, 0), "talk_seconds": 10}],
            outbound_records=[{"outbound_time": datetime(2026, 7, 31, 9, 0), "talk_seconds": 0}],
        )
        application = Mock()
        application.require_result.return_value = {"charts": {}}
        application.ensure_cached_records.return_value = records
        selection = TimeRangeSelection(date(2026, 7, 1), date(2026, 7, 31), "2026-07-01 至 2026-07-31（自定义）")
        output = StringIO()

        with patch("missed_call_backend.cli_trend_range.prompt_time_range_selection", return_value=selection), patch(
            "builtins.input", return_value=""
        ), redirect_stdout(output):
            show_period_summary(application)

        rendered = output.getvalue()
        self.assertIn("时间段通话总览", rendered)
        self.assertIn("2026-07-01 至 2026-07-31（自定义）", rendered)
        self.assertIn("呼入总数", rendered)
        self.assertIn("呼出成功率", rendered)
        self.assertNotIn("趋势条", rendered)
        self.assertNotIn("每日", rendered)


if __name__ == "__main__":
    unittest.main()
