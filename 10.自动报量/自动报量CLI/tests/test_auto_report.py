from __future__ import annotations

import os
import subprocess
import sys
import unittest
from datetime import date
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, call, patch

import openpyxl
from PIL import Image


CLI_DIRECTORY = Path(__file__).resolve().parents[1]
PROJECT_ROOT_DIRECTORY = CLI_DIRECTORY.parent
if str(CLI_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(CLI_DIRECTORY))

from auto_report_aggregation import aggregate_order_records  # noqa: E402
from auto_report_cli import (  # noqa: E402
    build_latest_cli_date_range,
    locate_order_csv_path,
    open_downloaded_source_data_directory,
    open_latest_result_workbook,
    open_template_directory,
    print_cli_home,
    prompt_erp_credentials,
    report_manual_erp_action_required,
    run_latest_import_workflow,
    run_one_click_erp_workflow,
)
from auto_report_config import load_runtime_report_config  # noqa: E402
from auto_report_credentials import (  # noqa: E402
    ERP_LOGIN_MODE_TENANT,
    ErpCredentials,
    build_erp_credentials_document,
    protect_erp_password,
    read_erp_credentials_document,
    unprotect_erp_password,
)
from auto_report_csv import read_order_csv_records  # noqa: E402
from auto_report_erp import (  # noqa: E402
    ErpBrowserClosedError,
    _wait_for_condition,
    build_erp_browser_launch_options,
    build_erp_export_date_range,
    create_erp_csv_export_task,
    maximize_erp_browser_window,
    open_erp_task_center,
    select_single_erp_work_page,
    set_erp_created_time_range,
)
from auto_report_paths import AutoReportPaths  # noqa: E402
from auto_report_password_input import read_password_with_delayed_mask  # noqa: E402
from auto_report_result_page import build_result_page_screenshot_bytes  # noqa: E402
from auto_report_xlsx import build_output_workbook_bytes  # noqa: E402


class AutoReportCliTests(unittest.TestCase):
    """验证报量核心规则、跨月写入和结果截图。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.project_paths = AutoReportPaths.from_project_root(PROJECT_ROOT_DIRECTORY)
        cls.report_config = load_runtime_report_config(
            cls.project_paths.report_config_path,
            cls.project_paths.runtime_override_config_path(),
        )
        cls.order_records, cls.csv_encoding_name = read_order_csv_records(
            cls.project_paths.order_csv_path,
            cls.report_config,
        )

    def test_july_third_aggregation_matches_existing_rule(self) -> None:
        aggregation_result = aggregate_order_records(
            self.order_records,
            self.report_config,
            date(2026, 7, 3),
            date(2026, 7, 3),
        )
        self.assertEqual(self.csv_encoding_name, "gb18030")
        self.assertEqual(aggregation_result.total_rows, 1703)
        self.assertEqual(aggregation_result.valid_rows, 370)
        self.assertEqual(aggregation_result.matched_rows, 228)
        self.assertEqual(aggregation_result.unmatched_rows, 142)
        self.assertEqual(aggregation_result.written_quantity, 229)

    def test_cross_month_range_writes_two_month_sheets(self) -> None:
        start_date = date(2026, 6, 29)
        end_date = date(2026, 7, 3)
        aggregation_result = aggregate_order_records(
            self.order_records,
            self.report_config,
            start_date,
            end_date,
        )
        output_bytes, month_results = build_output_workbook_bytes(
            self.project_paths.annual_template_workbook_path,
            self.report_config,
            aggregation_result,
            start_date,
            end_date,
        )
        workbook_values = openpyxl.load_workbook(BytesIO(output_bytes), read_only=True, data_only=True)
        self.assertEqual([result.sheet_name for result in month_results], ["2026-6", "2026-7"])
        self.assertEqual([result.target_date_count for result in month_results], [2, 3])
        self.assertEqual(workbook_values["2026-6"]["D3"].value, 14)
        self.assertEqual(workbook_values["2026-7"]["D3"].value, 729)

    def test_result_screenshot_is_png(self) -> None:
        aggregation_result = aggregate_order_records(
            self.order_records,
            self.report_config,
            date(2026, 7, 1),
            date(2026, 7, 3),
        )
        output_bytes, month_results = build_output_workbook_bytes(
            self.project_paths.annual_template_workbook_path,
            self.report_config,
            aggregation_result,
            date(2026, 7, 1),
            date(2026, 7, 3),
        )
        screenshot_bytes = build_result_page_screenshot_bytes(
            date(2026, 7, 1),
            date(2026, 7, 3),
            output_bytes,
        )
        self.assertTrue(screenshot_bytes.startswith(b"\x89PNG\r\n\x1a\n"))
        with Image.open(BytesIO(screenshot_bytes)) as screenshot_image:
            self.assertGreaterEqual(screenshot_image.width, 1800)
            self.assertLess(screenshot_image.width, 2200)
            self.assertGreater(screenshot_image.height, 20000)
            self.assertLess(screenshot_image.height, 23000)

    def test_template_directory_menu_is_visible_and_opens_source_directory(self) -> None:
        with patch("auto_report_cli.clear_cli_screen"), patch("sys.stdout", new_callable=StringIO) as output_stream:
            print_cli_home(self.project_paths)
        self.assertIn("1. 一键智能报量（ERP下载 → Excel → 结果图）", output_stream.getvalue())
        self.assertIn("2. 本地最新报量（最近3天，手动兜底）", output_stream.getvalue())
        self.assertIn("5. 打开最新结果表（Excel）", output_stream.getvalue())
        self.assertIn("6. 修改ERP账号/密码", output_stream.getvalue())
        self.assertIn("7. 打开模板文件夹", output_stream.getvalue())
        self.assertIn("8. 打开数据源下载文件夹", output_stream.getvalue())
        self.assertNotIn("打开配置目录", output_stream.getvalue())
        self.assertNotIn("JSON", output_stream.getvalue())
        with patch("auto_report_cli.open_directory_in_file_explorer") as open_directory_mock, patch(
            "builtins.input",
            return_value="",
        ):
            open_template_directory(self.project_paths)
        open_directory_mock.assert_called_once_with(self.project_paths.source_data_directory)

        with patch(
            "auto_report_cli.find_latest_erp_downloaded_csv_path",
            return_value=None,
        ), patch("auto_report_cli.open_directory_in_file_explorer") as open_directory_mock, patch(
            "builtins.input",
            return_value="",
        ):
            open_downloaded_source_data_directory(self.project_paths)
        open_directory_mock.assert_called_once_with(self.project_paths.erp_source_data_directory)

    def test_windows_launcher_opens_cli_home_without_crashing(self) -> None:
        launcher_path = self.project_paths.project_root_directory / "运行自动报量CLI.bat"
        launcher_bytes = launcher_path.read_bytes()
        self.assertNotIn(b"\n", launcher_bytes.replace(b"\r\n", b""))
        # bat 不带 --launcher-maximized 时会 start 新窗口重入自身后 exit /b，
        # 输出进新窗口导致捕获 stdout 恒空且分离孙进程持有管道句柄造成挂起；
        # 因此直接传参走内联分支，并把当前解释器目录前置到 PATH 保证 where python 命中。
        launcher_environment = dict(os.environ, AUTO_REPORT_NO_OPEN="1")
        launcher_environment["PATH"] = (
            str(Path(sys.executable).parent) + os.pathsep + launcher_environment.get("PATH", "")
        )
        completed_process = subprocess.run(
            [os.environ["COMSPEC"], "/d", "/c", str(launcher_path), "--launcher-maximized"],
            input="0\r\n",
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
            env=launcher_environment,
        )
        self.assertEqual(completed_process.returncode, 0, completed_process.stdout)
        self.assertIn("luyao2089.cc", completed_process.stdout)
        self.assertIn("v0.01", completed_process.stdout)

    def test_local_fallback_automatically_uses_latest_available_source(self) -> None:
        latest_available_source_path = self.project_paths.erp_source_data_directory / "最新数据.csv"
        with patch(
            "auto_report_cli.locate_latest_available_order_csv_path",
            return_value=latest_available_source_path,
        ) as locate_latest_source_mock:
            selected_source_path = locate_order_csv_path(self.project_paths)
        self.assertEqual(selected_source_path, latest_available_source_path)
        locate_latest_source_mock.assert_called_once_with(self.project_paths)

    def test_open_latest_result_workbook_opens_the_newest_excel_file(self) -> None:
        latest_result_workbook_path = self.project_paths.result_workbook_directory / "最新结果.xlsx"
        with patch(
            "auto_report_cli.find_latest_result_workbook_path",
            return_value=latest_result_workbook_path,
        ), patch("auto_report_cli.open_file_in_default_application") as open_file_mock, patch(
            "builtins.input",
            return_value="",
        ):
            open_latest_result_workbook(self.project_paths)
        open_file_mock.assert_called_once_with(latest_result_workbook_path)

    def test_open_latest_result_workbook_opens_directory_when_empty(self) -> None:
        with patch("auto_report_cli.find_latest_result_workbook_path", return_value=None), patch(
            "auto_report_cli.open_directory_in_file_explorer"
        ) as open_directory_mock, patch("builtins.input", return_value=""):
            open_latest_result_workbook(self.project_paths)
        open_directory_mock.assert_called_once_with(self.project_paths.result_workbook_directory)

    def test_latest_date_range_contains_today_and_previous_two_days(self) -> None:
        self.assertEqual(
            build_latest_cli_date_range(date(2026, 8, 4)),
            (date(2026, 8, 2), date(2026, 8, 4)),
        )

    def test_latest_workflow_uses_automatic_date_range(self) -> None:
        automatic_date_range = (date(2026, 8, 2), date(2026, 8, 4))
        with patch("auto_report_cli.build_latest_cli_date_range", return_value=automatic_date_range), patch(
            "auto_report_cli.run_import_workflow"
        ) as run_import_workflow_mock:
            run_latest_import_workflow(self.project_paths)
        run_import_workflow_mock.assert_called_once_with(self.project_paths, automatic_date_range)

    def test_erp_export_range_uses_month_start_and_tomorrow_midnight(self) -> None:
        export_date_range = build_erp_export_date_range(date(2026, 8, 4))
        self.assertEqual(export_date_range.start_text(), "2026-08-01 00:00:00")
        self.assertEqual(export_date_range.end_text(), "2026-08-05 00:00:00")

    def test_erp_browser_window_is_forced_to_maximized_state(self) -> None:
        browser_page = MagicMock()
        browser_control_session = MagicMock()
        browser_control_session.send.side_effect = [
            {"windowId": 17},
            {},
        ]
        browser_context = MagicMock()
        browser_context.new_cdp_session.return_value = browser_control_session

        maximize_erp_browser_window(browser_context, browser_page)

        browser_page.wait_for_timeout.assert_called_once_with(300)
        browser_context.new_cdp_session.assert_called_once_with(browser_page)
        self.assertEqual(
            browser_control_session.send.call_args_list,
            [
                call("Browser.getWindowForTarget"),
                call(
                    "Browser.setWindowBounds",
                    {
                        "windowId": 17,
                        "bounds": {"windowState": "maximized"},
                    },
                ),
            ],
        )
        browser_control_session.detach.assert_called_once_with()

    def test_erp_browser_viewport_follows_maximized_window_size(self) -> None:
        launch_options = build_erp_browser_launch_options(
            browser_profile_directory=Path("browser-profile"),
            browser_executable_path=Path("msedge.exe"),
            download_directory=Path("downloads"),
        )
        self.assertIs(launch_options["no_viewport"], True)
        self.assertNotIn("viewport", launch_options)
        self.assertEqual(launch_options["args"], ["--start-maximized"])

    def test_erp_browser_keeps_only_one_fresh_work_page(self) -> None:
        restored_report_page = MagicMock()
        restored_report_page.url = "https://v2.guanyierp.com/report/old"
        restored_report_page.is_closed.return_value = False
        blank_work_page = MagicMock()
        blank_work_page.url = "about:blank"
        blank_work_page.is_closed.return_value = False
        restored_task_page = MagicMock()
        restored_task_page.url = "https://v2.guanyierp.com/task/task_center"
        restored_task_page.is_closed.return_value = False
        browser_context = MagicMock()
        browser_context.pages = [
            restored_report_page,
            blank_work_page,
            restored_task_page,
        ]

        selected_work_page = select_single_erp_work_page(browser_context)

        self.assertIs(selected_work_page, blank_work_page)
        restored_report_page.close.assert_called_once_with()
        restored_task_page.close.assert_called_once_with()
        blank_work_page.close.assert_not_called()
        browser_context.new_page.assert_not_called()

    def test_erp_created_time_waits_for_real_inputs_before_filling(self) -> None:
        browser_page = MagicMock()
        start_time_input = MagicMock()
        end_time_input = MagicMock()
        export_date_range = build_erp_export_date_range(date(2026, 8, 4))

        def run_waited_condition(
            page: Any,
            condition: Any,
            **_: Any,
        ) -> bool:
            self.assertIs(page, browser_page)
            return condition()

        with patch(
            "auto_report_erp._find_visible_erp_created_time_inputs",
            return_value=(start_time_input, end_time_input),
        ), patch(
            "auto_report_erp._wait_for_condition",
            side_effect=run_waited_condition,
        ):
            set_erp_created_time_range(browser_page, export_date_range)

        start_time_input.fill.assert_called_once_with("2026-08-01 00:00:00")
        end_time_input.fill.assert_called_once_with("2026-08-05 00:00:00")
        start_time_input.press.assert_called_once_with("Tab")
        end_time_input.press.assert_called_once_with("Tab")

    def test_erp_export_confirms_both_real_dialogs(self) -> None:
        browser_page = MagicMock()
        query_button = MagicMock()
        csv_export_button = MagicMock()
        first_confirmation_button = MagicMock()
        second_confirmation_button = MagicMock()

        def find_toolbar_button(
            page: Any,
            visible_text: str,
            exact: bool = True,
        ) -> Any:
            self.assertIs(page, browser_page)
            self.assertTrue(exact)
            return {
                "查询汇总": query_button,
                "CSV导出": csv_export_button,
            }[visible_text]

        def run_waited_condition(
            page: Any,
            condition: Any,
            **_: Any,
        ) -> bool:
            self.assertIs(page, browser_page)
            return condition()

        with patch(
            "auto_report_erp._find_first_visible_text_locator",
            side_effect=find_toolbar_button,
        ), patch(
            "auto_report_erp._erp_export_task_is_submitted",
            side_effect=[False, False, True],
        ), patch(
            "auto_report_erp._find_visible_erp_export_confirmation_button",
            side_effect=[first_confirmation_button, second_confirmation_button],
        ), patch(
            "auto_report_erp._wait_for_condition",
            side_effect=run_waited_condition,
        ):
            export_started_at = create_erp_csv_export_task(browser_page)

        self.assertIsNotNone(export_started_at)
        query_button.click.assert_called_once_with()
        csv_export_button.click.assert_called_once_with()
        first_confirmation_button.click.assert_called_once_with()
        second_confirmation_button.click.assert_called_once_with()

    def test_task_center_uses_erp_own_same_window_entry(self) -> None:
        browser_page = MagicMock()
        task_center_tab = MagicMock()
        task_center_frame = MagicMock()
        completed_tab = MagicMock()
        wait_call_count = 0

        def wait_for_task_center(
            page: Any,
            condition: Any,
            **_: Any,
        ) -> bool:
            nonlocal wait_call_count
            self.assertIs(page, browser_page)
            wait_call_count += 1
            if wait_call_count == 1:
                return condition()
            return True

        with patch(
            "auto_report_erp._wait_for_condition",
            side_effect=wait_for_task_center,
        ), patch(
            "auto_report_erp._find_first_visible_text_locator",
            return_value=task_center_tab,
        ), patch(
            "auto_report_erp._find_erp_task_center_frame",
            return_value=task_center_frame,
        ), patch(
            "auto_report_erp._find_first_visible_text_locator_in_scope",
            return_value=completed_tab,
        ):
            open_erp_task_center(browser_page)

        evaluate_script, task_center_message = browser_page.evaluate.call_args.args
        self.assertIn("window.postMessage", evaluate_script)
        self.assertEqual(task_center_message["type"], "openMenuTab")
        self.assertEqual(
            task_center_message["handlePageData"]["url"],
            "/task/task_center",
        )
        task_center_tab.click.assert_called_once_with()
        completed_tab.click.assert_called_once_with()

    def test_browser_close_cancels_wait_immediately(self) -> None:
        closed_browser_page = MagicMock()
        closed_browser_page.is_closed.return_value = True
        condition_mock = MagicMock(return_value=False)
        with self.assertRaises(ErpBrowserClosedError):
            _wait_for_condition(
                closed_browser_page,
                condition_mock,
                timeout_seconds=600,
            )
        condition_mock.assert_not_called()

    def test_erp_credentials_document_does_not_store_plaintext_password(self) -> None:
        credentials = ErpCredentials(
            login_mode=ERP_LOGIN_MODE_TENANT,
            tenant_code="tenant-code",
            account_name="service-account",
            password="secret-password",
        )
        credentials_document = build_erp_credentials_document(
            credentials,
            password_protector=lambda password: f"protected:{len(password)}",
        )
        self.assertNotIn("secret-password", str(credentials_document))
        restored_credentials = read_erp_credentials_document(
            credentials_document,
            password_unprotector=lambda protected_text: "secret-password",
        )
        self.assertEqual(restored_credentials.account_name, "service-account")
        self.assertEqual(restored_credentials.password, "secret-password")

    def test_windows_password_protection_round_trip(self) -> None:
        protected_password = protect_erp_password("temporary-test-password")
        self.assertNotIn("temporary-test-password", protected_password)
        self.assertEqual(unprotect_erp_password(protected_password), "temporary-test-password")

    def test_erp_credentials_prompt_defaults_to_common_account_login(self) -> None:
        with patch(
            "builtins.input",
            side_effect=["", "service-account"],
        ), patch(
            "auto_report_cli.read_password_with_delayed_mask",
            return_value="secret-password",
        ):
            credentials = prompt_erp_credentials()
        self.assertEqual(credentials.login_mode, "account")
        self.assertEqual(credentials.account_name, "service-account")
        self.assertEqual(credentials.tenant_code, "")

    def test_manual_erp_action_notice_does_not_require_enter(self) -> None:
        with patch("sys.stdout", new_callable=StringIO) as output_stream, patch(
            "builtins.input",
            side_effect=AssertionError("不应等待回车"),
        ):
            report_manual_erp_action_required("请完成浏览器登录。")
        self.assertIn("完成后程序会自动继续", output_stream.getvalue())

    def test_password_character_is_replaced_with_mask_after_delay(self) -> None:
        scheduled_timers: list[Any] = []

        class FakeMaskTimer:
            """允许测试主动触发遮罩，而无需真实等待。"""

            def __init__(self, callback: Any) -> None:
                self.callback = callback
                self.cancelled = False
                self.daemon = False

            def start(self) -> None:
                return None

            def cancel(self) -> None:
                self.cancelled = True

            def fire(self) -> None:
                if not self.cancelled:
                    self.callback()

        def build_fake_timer(delay_seconds: float, callback: Any) -> FakeMaskTimer:
            self.assertEqual(delay_seconds, 1.0)
            timer = FakeMaskTimer(callback)
            scheduled_timers.append(timer)
            return timer

        input_characters = iter(["a", "b", "\r"])
        character_read_count = 0

        def read_simulated_character() -> str:
            nonlocal character_read_count
            if character_read_count > 0:
                scheduled_timers[-1].fire()
            character_read_count += 1
            return next(input_characters)

        output_stream = StringIO()
        password = read_password_with_delayed_mask(
            "密码：",
            character_reader=read_simulated_character,
            output_stream=output_stream,
            timer_factory=build_fake_timer,
        )
        self.assertEqual(password, "ab")
        self.assertEqual(output_stream.getvalue(), "密码：a\b*b\b*\n")

    def test_one_click_workflow_downloads_then_builds_latest_result(self) -> None:
        reference_date = date(2026, 8, 4)
        credentials = ErpCredentials(
            login_mode=ERP_LOGIN_MODE_TENANT,
            tenant_code="tenant-code",
            account_name="service-account",
            password="secret-password",
        )
        downloaded_order_csv_path = self.project_paths.order_csv_path
        with patch("auto_report_cli.require_erp_credentials", return_value=credentials), patch(
            "auto_report_cli.download_order_source_from_erp",
            return_value=downloaded_order_csv_path,
        ) as download_mock, patch("auto_report_cli.run_import_workflow") as import_workflow_mock:
            run_one_click_erp_workflow(self.project_paths, reference_date)
        download_mock.assert_called_once_with(
            credentials=credentials,
            browser_profile_directory=self.project_paths.erp_browser_profile_directory,
            download_directory=self.project_paths.erp_source_data_directory,
            progress_callback=unittest.mock.ANY,
            manual_action_callback=unittest.mock.ANY,
            reference_date=reference_date,
        )
        import_workflow_mock.assert_called_once_with(
            self.project_paths,
            selected_date_range=(date(2026, 8, 2), date(2026, 8, 4)),
            selected_order_csv_path=downloaded_order_csv_path,
            require_user_confirmation=False,
        )

    def test_one_click_unexpected_failure_keeps_manual_fallback_available(self) -> None:
        credentials = ErpCredentials(
            login_mode=ERP_LOGIN_MODE_TENANT,
            tenant_code="tenant-code",
            account_name="service-account",
            password="secret-password",
        )
        with patch("auto_report_cli.require_erp_credentials", return_value=credentials), patch(
            "auto_report_cli.download_order_source_from_erp",
            side_effect=RuntimeError("页面临时变化"),
        ), patch("builtins.input", return_value=""), patch(
            "sys.stdout",
            new_callable=StringIO,
        ) as output_stream:
            run_one_click_erp_workflow(self.project_paths, date(2026, 8, 4))
        self.assertIn("ERP自动报量未完成", output_stream.getvalue())
        self.assertIn("第2或第3项切回本地手动报量", output_stream.getvalue())

    def test_browser_close_returns_home_without_waiting_for_enter(self) -> None:
        credentials = ErpCredentials(
            login_mode=ERP_LOGIN_MODE_TENANT,
            tenant_code="tenant-code",
            account_name="service-account",
            password="secret-password",
        )
        with patch("auto_report_cli.require_erp_credentials", return_value=credentials), patch(
            "auto_report_cli.download_order_source_from_erp",
            side_effect=ErpBrowserClosedError("ERP浏览器已关闭，本次自动报量已取消。"),
        ), patch("builtins.input", side_effect=AssertionError("不应等待回车")), patch(
            "sys.stdout",
            new_callable=StringIO,
        ) as output_stream:
            run_one_click_erp_workflow(self.project_paths, date(2026, 8, 4))
        self.assertIn("已返回首页", output_stream.getvalue())
        self.assertIn("第6项修改账号", output_stream.getvalue())


if __name__ == "__main__":
    unittest.main()
