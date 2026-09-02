#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from refund_reminder.config import default_config
from refund_reminder.erp_page import ErpBrowser, _has_order_page_landmarks, _is_locator_timeout_error, _is_login_wait_page_text, _is_navigation_context_error, diagnose_order_page_text


class ErpPageTest(unittest.TestCase):
    def test_navigation_context_error_is_expected_after_click(self) -> None:
        error = RuntimeError("Page.evaluate: Execution context was destroyed, most likely because of a navigation")
        self.assertTrue(_is_navigation_context_error(error))

    def test_detached_frame_is_treated_as_navigation_context_error(self) -> None:
        error = RuntimeError("Frame was detached")
        self.assertTrue(_is_navigation_context_error(error))

    def test_other_errors_are_not_navigation_context_errors(self) -> None:
        self.assertFalse(_is_navigation_context_error(RuntimeError("登录按钮不存在")))

    def test_locator_bounding_box_timeout_is_identified(self) -> None:
        error = RuntimeError('Locator.bounding_box: Timeout 300ms exceeded. Call log: - waiting for locator("input").first')
        self.assertTrue(_is_locator_timeout_error(error))

    def test_order_query_page_landmarks_are_enough(self) -> None:
        text = "首页 订单查询 查询 重置 默认筛选 单据时间 订单明细 商品明细"
        self.assertTrue(_has_order_page_landmarks(text))

    def test_two_order_query_page_landmarks_are_not_enough(self) -> None:
        text = "首页 订单查询 默认筛选 单据时间"
        self.assertFalse(_has_order_page_landmarks(text))

    def test_menu_search_result_is_not_enough(self) -> None:
        text = "菜单 订单查询 订单管理 商品管理"
        self.assertFalse(_has_order_page_landmarks(text))

    def test_order_page_diagnosis_lists_matched_landmarks(self) -> None:
        diagnosis = diagnose_order_page_text("首页 订单查询 默认筛选 单据时间 订单明细")
        self.assertTrue(diagnosis.ready)
        self.assertEqual(diagnosis.matched_count, 3)
        self.assertEqual(diagnosis.matched_landmarks, ("默认筛选", "单据时间", "订单明细"))

    def test_public_login_page_waits_for_user_without_actions(self) -> None:
        text = "金蝶管易云 网站首页 产品中心 解决方案 标杆案例 服务保障 关于我们 登录 申请试用 淘宝账号登录 账户登录 租户登录 我已阅读并同意 用户协议 隐私政策"
        self.assertTrue(_is_login_wait_page_text(text))
        diagnosis = diagnose_order_page_text(text)
        self.assertFalse(diagnosis.ready)
        self.assertTrue(diagnosis.login_wait_page)

    def test_erp_home_page_is_not_public_login_page(self) -> None:
        text = "金蝶管易云 数据看板 用户信息 登录用户 我的工单 售后服务 订单查询 未配货 未退款 未退货"
        self.assertFalse(_is_login_wait_page_text(text))

    def test_order_page_diagnosis_key_is_stable_for_same_state(self) -> None:
        text = "金蝶管易云 网站首页 产品中心 解决方案 标杆案例 服务保障 关于我们 登录 申请试用 淘宝账号登录 账户登录"
        first = diagnose_order_page_text(text)
        second = diagnose_order_page_text(text)
        self.assertEqual(ErpBrowser._diagnosis_key(first), ErpBrowser._diagnosis_key(second))

    def test_browser_start_timeout_comes_from_login_config(self) -> None:
        config = default_config()
        config = replace(config, login=replace(config.login, browser_start_timeout_sec=88))
        self.assertEqual(ErpBrowser._browser_start_timeout_sec((config,)), 88)

    def test_login_page_uses_login_wait_timeout(self) -> None:
        class FakePage:
            url = "https://v2.guanyierp.com/index"

            def title(self) -> str:
                return "登录页"

            def is_closed(self) -> bool:
                return False

        config = default_config()
        config = replace(
            config,
            login=replace(
                config.login,
                login_wait_timeout_sec=0.03,
                order_page_wait_timeout_sec=10,
                poll_interval_sec=0.01,
            ),
        )
        browser = ErpBrowser(profile_root=Path("."))
        diagnosis = diagnose_order_page_text("淘宝账号登录 账户登录 租户登录 我已阅读并同意")
        browser._diagnose_order_page = lambda _page, _config: diagnosis  # type: ignore[method-assign]
        with self.assertRaisesRegex(RuntimeError, "等待登录超时"):
            browser._do_wait_order_page(FakePage(), Path("profile"), config, None)

    def test_navigation_during_title_read_keeps_waiting(self) -> None:
        class NavigatingTitlePage:
            url = "https://login.guanyierp.com/login"

            def title(self) -> str:
                raise RuntimeError("Page.title: Execution context was destroyed, most likely because of a navigation")

            def is_closed(self) -> bool:
                return False

        config = default_config()
        config = replace(
            config,
            login=replace(config.login, login_wait_timeout_sec=0.03, order_page_wait_timeout_sec=10, poll_interval_sec=0.01),
        )
        browser = ErpBrowser(profile_root=Path("."))
        diagnosis = diagnose_order_page_text("淘宝账号登录 账户登录 租户登录 我已阅读并同意")
        browser._diagnose_order_page = lambda _page, _config: diagnosis  # type: ignore[method-assign]
        with self.assertRaisesRegex(RuntimeError, "等待登录超时"):
            browser._do_wait_order_page(NavigatingTitlePage(), Path("profile"), config, None)

    def test_safe_page_state_tolerates_navigation_title_error(self) -> None:
        class NavigatingTitlePage:
            url = "https://login.guanyierp.com/login"

            def title(self) -> str:
                raise RuntimeError("Page.title: Execution context was destroyed, most likely because of a navigation")

        state = ErpBrowser(profile_root=Path("."))._page_state(NavigatingTitlePage(), Path("profile"))

        self.assertEqual(state.title, "页面跳转中")
        self.assertEqual(state.url, "https://login.guanyierp.com/login")

    def test_non_navigation_diagnosis_error_is_exposed(self) -> None:
        class BrokenPage:
            frames = []

            def evaluate(self, _script: str) -> str:
                raise RuntimeError("脚本注入失败")

        browser = ErpBrowser(profile_root=Path("."))

        with self.assertRaisesRegex(RuntimeError, "读取订单页诊断失败"):
            browser._diagnose_order_page(BrokenPage(), default_config())

    def test_navigation_diagnosis_error_keeps_polling(self) -> None:
        class NavigatingPage:
            frames = []

            def evaluate(self, _script: str) -> str:
                raise RuntimeError("Frame was detached")

        diagnosis = ErpBrowser(profile_root=Path("."))._diagnose_order_page(NavigatingPage(), default_config())

        self.assertFalse(diagnosis.ready)
        self.assertEqual(diagnosis.text_sample, "")

    def test_scan_exports_current_page_and_filters_workbook(self) -> None:
        class FakePage:
            url = "https://v2.guanyierp.com/index"

            def title(self) -> str:
                return "订单查询"

            def is_closed(self) -> bool:
                return False

        browser = ErpBrowser(profile_root=Path("."))
        browser._require_page = lambda _page, _profile: None  # type: ignore[method-assign]
        browser._do_wait_order_page = lambda _page, _profile, _config, _status: None  # type: ignore[method-assign]
        config = default_config()
        grid_payload = {
            "source": "visible-ag-grid",
            "headers": ["平台单号"],
            "rows": [["P001"], ["P002"]],
        }
        workbook_payload = {
            "source": "unit-xlsx",
            "headers": ["平台单号", "订单编号", "店铺", "支付日期", "退款"],
            "rows": [
                ["P001", "SO001", "测试店", "2026-06-17 10:00:00", "√"],
                ["P002", "SO002", "测试店", "2026-01-01 10:00:00", "√"],
            ],
        }

        statuses: list[str] = []
        with patch("refund_reminder.erp_page.scan_orders.ensure_custom_filter_panel", return_value={"fields_visible": True, "source": "test"}), patch(
            "refund_reminder.erp_page.scan_orders.click_search", return_value=True
        ), patch("refund_reminder.erp_page.scan_orders.time.sleep") as sleep_mock, patch(
            "refund_reminder.erp_page.scan_orders._call_scan_visible_order_rows", return_value=grid_payload
        ), patch("refund_reminder.erp_page.scan_orders.export_current_order_page", return_value=Path("订单查询.xlsx")), patch(
            "refund_reminder.erp_page.scan_orders.read_exported_order_workbook", return_value=workbook_payload
        ):
            summary = browser._do_scan_orders(FakePage(), Path("profile"), config, statuses.append)

        self.assertEqual(len(summary.detection.problem_orders), 2)
        self.assertEqual(summary.detection.problem_orders[0].row["平台单号"], "P001")
        sleep_mock.assert_called_once_with(5.0)
        self.assertTrue(any("导出读取 2 行" in item for item in statuses))

    def test_scan_reports_problem_order_after_export_detection(self) -> None:
        class FakePage:
            url = "https://v2.guanyierp.com/index"

            def title(self) -> str:
                return "订单查询"

            def is_closed(self) -> bool:
                return False

        browser = ErpBrowser(profile_root=Path("."))
        browser._require_page = lambda _page, _profile: None  # type: ignore[method-assign]
        browser._do_wait_order_page = lambda _page, _profile, _config, _status: None  # type: ignore[method-assign]
        config = default_config()
        grid_payload = {
            "source": "visible-ag-grid",
            "headers": ["平台单号"],
            "rows": [["P001"], ["P002"]],
        }
        workbook_payload = {
            "source": "unit-xlsx",
            "headers": ["平台单号", "订单编号", "店铺", "支付日期", "退款"],
            "rows": [
                ["P001", "SO001", "测试店", "2026-06-17 10:00:00", "√"],
                ["P002", "SO002", "测试店", "2026-01-01 10:00:00", "√"],
            ],
        }

        statuses: list[str] = []
        incremental_orders = []
        with patch("refund_reminder.erp_page.scan_orders.ensure_custom_filter_panel", return_value={"fields_visible": True, "source": "test"}), patch(
            "refund_reminder.erp_page.scan_orders.click_search", return_value=True
        ), patch("refund_reminder.erp_page.scan_orders.time.sleep"), patch(
            "refund_reminder.erp_page.scan_orders._call_scan_visible_order_rows", return_value=grid_payload
        ), patch("refund_reminder.erp_page.scan_orders.export_current_order_page", return_value=Path("订单查询.xlsx")), patch(
            "refund_reminder.erp_page.scan_orders.read_exported_order_workbook", return_value=workbook_payload
        ):
            summary = browser._do_scan_orders(FakePage(), Path("profile"), config, statuses.append, incremental_orders.append)

        self.assertEqual([order.row["平台单号"] for order in incremental_orders], ["P001", "P002"])
        self.assertEqual([order.row["平台单号"] for order in summary.detection.problem_orders], ["P001", "P002"])
        self.assertTrue(any("订单扫描完成" in item for item in statuses))

    def test_scan_clicks_query_then_waits_fixed_delay_before_export(self) -> None:
        class FakePage:
            url = "https://v2.guanyierp.com/index"

            def title(self) -> str:
                return "订单查询"

            def is_closed(self) -> bool:
                return False

        browser = ErpBrowser(profile_root=Path("."))
        browser._require_page = lambda _page, _profile: None  # type: ignore[method-assign]
        browser._do_wait_order_page = lambda _page, _profile, _config, _status: None  # type: ignore[method-assign]
        config = default_config()
        grid_payload = {"source": "visible-ag-grid", "headers": ["平台单号"], "rows": [["P999"]]}
        workbook_payload = {
            "source": "unit-xlsx",
            "headers": ["平台单号", "订单编号", "店铺", "支付日期", "退款"],
            "rows": [["P999", "SO001", "测试店", "2026-06-17 10:00:00", "√"]],
        }

        def fake_export(_page, _config, _path, status=None):
            if status:
                status("当前页订单已导出。")
            return Path("订单查询.xlsx")

        statuses: list[str] = []
        with patch("refund_reminder.erp_page.scan_orders.ensure_custom_filter_panel", return_value={"fields_visible": True, "source": "test"}), patch(
            "refund_reminder.erp_page.scan_orders.click_search", return_value=True
        ) as click_mock, patch("refund_reminder.erp_page.scan_orders.time.sleep") as sleep_mock, patch(
            "refund_reminder.erp_page.scan_orders._call_scan_visible_order_rows", return_value=grid_payload
        ), patch("refund_reminder.erp_page.scan_orders.export_current_order_page", side_effect=fake_export), patch(
            "refund_reminder.erp_page.scan_orders.read_exported_order_workbook", return_value=workbook_payload
        ):
            summary = browser._do_scan_orders(FakePage(), Path("profile"), config, statuses.append)

        self.assertEqual([order.row["平台单号"] for order in summary.detection.problem_orders], ["P999"])
        click_mock.assert_called_once()
        sleep_mock.assert_called_once_with(5.0)
        self.assertTrue(any("固定等待 5 秒" in item for item in statuses))
        self.assertTrue(any("等待后当前页订单表快照" in item for item in statuses))

    def test_scan_does_not_block_export_when_snapshot_has_no_headers(self) -> None:
        class FakePage:
            url = "https://v2.guanyierp.com/index"

            def title(self) -> str:
                return "订单查询"

            def is_closed(self) -> bool:
                return False

        browser = ErpBrowser(profile_root=Path("."))
        browser._require_page = lambda _page, _profile: None  # type: ignore[method-assign]
        browser._do_wait_order_page = lambda _page, _profile, _config, _status: None  # type: ignore[method-assign]
        config = default_config()
        workbook_payload = {
            "source": "unit-xlsx",
            "headers": ["平台单号", "订单编号", "店铺", "支付日期", "退款"],
            "rows": [],
        }

        with patch("refund_reminder.erp_page.scan_orders.ensure_custom_filter_panel", return_value={"fields_visible": True, "source": "test"}), patch(
            "refund_reminder.erp_page.scan_orders.click_search", return_value=True
        ), patch("refund_reminder.erp_page.scan_orders.time.sleep"), patch(
            "refund_reminder.erp_page.scan_orders._call_scan_visible_order_rows",
            return_value={"source": "not-found", "headers": [], "rows": []},
        ), patch("refund_reminder.erp_page.scan_orders.export_current_order_page", return_value=Path("订单查询.xlsx")) as export_mock, patch(
            "refund_reminder.erp_page.scan_orders.read_exported_order_workbook", return_value=workbook_payload
        ):
            summary = browser._do_scan_orders(FakePage(), Path("profile"), config, None)

        export_mock.assert_called_once()
        self.assertEqual(summary.detection.total_rows, 0)

    def test_scan_refuses_export_when_query_button_is_missing(self) -> None:
        class FakePage:
            url = "https://v2.guanyierp.com/index"

            def title(self) -> str:
                return "订单查询"

            def is_closed(self) -> bool:
                return False

        browser = ErpBrowser(profile_root=Path("."))
        browser._require_page = lambda _page, _profile: None  # type: ignore[method-assign]
        browser._do_wait_order_page = lambda _page, _profile, _config, _status: None  # type: ignore[method-assign]
        config = default_config()

        with patch("refund_reminder.erp_page.scan_orders.ensure_custom_filter_panel", return_value={"fields_visible": True, "source": "test"}), patch(
            "refund_reminder.erp_page.scan_orders.click_search", return_value=False
        ), patch("refund_reminder.erp_page.scan_orders.export_current_order_page") as export_mock:
            with self.assertRaisesRegex(RuntimeError, "未找到可点击的「查询」按钮"):
                browser._do_scan_orders(FakePage(), Path("profile"), config, None)

        export_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
