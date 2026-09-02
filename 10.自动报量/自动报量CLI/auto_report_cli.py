from __future__ import annotations

import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from auto_report_aggregation import ReportAggregationResult, aggregate_order_records
from auto_report_config import (
    load_runtime_report_config,
)
from auto_report_credentials import (
    ERP_LOGIN_MODE_ACCOUNT,
    ERP_LOGIN_MODE_TENANT,
    ErpCredentials,
    load_erp_credentials,
    save_erp_credentials,
)
from auto_report_csv import read_order_csv_records
from auto_report_erp import (
    ErpAutomationError,
    ErpBrowserClosedError,
    download_order_source_from_erp,
)
from auto_report_paths import AutoReportPaths
from auto_report_password_input import read_password_with_delayed_mask
from auto_report_result_page import build_result_page_screenshot_bytes
from auto_report_screenshot import write_result_screenshot
from auto_report_xlsx import MonthWriteResult, build_output_workbook_bytes, read_workbook_sheet_paths


CLI_VERSION = "v0.01"
AUTHOR_NAME = "黎路遥"
AUTHOR_WECHAT = "luyao2089"
AUTHOR_WEBSITE = "luyao2089.cc"


class CliColors:
    """集中管理CLI彩色字体。"""

    RESET = "\033[0m"
    BRIGHT = "\033[1m"
    CYAN = "\033[96m"
    BLUE = "\033[94m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    GRAY = "\033[90m"


def enable_windows_ansi_colors() -> None:
    """尽量开启Windows终端的ANSI彩色输出。"""
    if os.name != "nt":
        return
    try:
        import ctypes

        standard_output_handle = ctypes.windll.kernel32.GetStdHandle(-11)
        current_console_mode = ctypes.c_uint32()
        if ctypes.windll.kernel32.GetConsoleMode(standard_output_handle, ctypes.byref(current_console_mode)):
            ctypes.windll.kernel32.SetConsoleMode(standard_output_handle, current_console_mode.value | 0x0004)
    except Exception:
        return


def colorize_cli_text(text: str, color_code: str) -> str:
    """给终端文本添加颜色，重定向输出时自动去掉颜色。"""
    if not sys.stdout.isatty():
        return text
    return f"{color_code}{text}{CliColors.RESET}"


def clear_cli_screen() -> None:
    """清理当前CLI画面。"""
    os.system("cls" if os.name == "nt" else "clear")


def format_cli_number(raw_number: Any) -> str:
    """格式化CLI中的数量。"""
    numeric_value = float(raw_number or 0)
    if numeric_value == int(numeric_value):
        return f"{int(numeric_value):,}"
    return f"{numeric_value:,.4f}".rstrip("0").rstrip(".")


def build_project_paths() -> AutoReportPaths:
    """根据入口文件位置构建项目路径。"""
    project_root_directory = Path(__file__).resolve().parents[1]
    return AutoReportPaths.from_project_root(project_root_directory)


def print_cli_home(paths: AutoReportPaths) -> None:
    """绘制CLI首页和功能菜单。"""
    clear_cli_screen()
    print(colorize_cli_text("╔════════════════════════════════════════════════════════════╗", CliColors.CYAN))
    print(colorize_cli_text("║                     自动报量 CLI                           ║", CliColors.BRIGHT + CliColors.BLUE))
    print(colorize_cli_text("╚════════════════════════════════════════════════════════════╝", CliColors.CYAN))
    print(colorize_cli_text(f"作者：{AUTHOR_NAME}  ｜  微信：{AUTHOR_WECHAT}", CliColors.YELLOW))
    print(colorize_cli_text(f"官网：{AUTHOR_WEBSITE}  ｜  版本：{CLI_VERSION}", CliColors.GREEN))
    print(colorize_cli_text(f"结果目录：{paths.result_root_directory}", CliColors.GRAY))
    print()
    print(colorize_cli_text("请选择功能：", CliColors.BRIGHT))
    print(colorize_cli_text("  1. 一键智能报量（ERP下载 → Excel → 结果图）", CliColors.GREEN + CliColors.BRIGHT))
    print(colorize_cli_text("  2. 本地最新报量（最近3天，手动兜底）", CliColors.GREEN))
    print(colorize_cli_text("  3. 手动日期报量", CliColors.GREEN))
    print(colorize_cli_text("  4. 打开截图目录", CliColors.CYAN))
    print(colorize_cli_text("  5. 打开最新结果表（Excel）", CliColors.CYAN))
    print(colorize_cli_text("  6. 修改ERP账号/密码", CliColors.YELLOW))
    print(colorize_cli_text("  7. 打开模板文件夹", CliColors.CYAN))
    print(colorize_cli_text("  8. 打开数据源下载文件夹", CliColors.CYAN))
    print(colorize_cli_text("  9. 查看最近处理日志", CliColors.CYAN))
    print(colorize_cli_text("  0. 退出", CliColors.GRAY))
    print()


def build_latest_cli_date_range(reference_date: date | None = None) -> tuple[date, date]:
    """生成最近3天的日期范围，范围包含参考日。"""
    latest_date = reference_date or date.today()
    return latest_date - timedelta(days=2), latest_date


def parse_cli_date_input(input_text: str, default_date: date) -> date:
    """解析用户输入的日期，空输入使用默认日期。"""
    normalized_input = input_text.strip()
    if not normalized_input:
        return default_date
    try:
        return date.fromisoformat(normalized_input)
    except ValueError as error:
        raise ValueError("日期格式应为YYYY-MM-DD，例如2026-07-03。") from error


def prompt_cli_date_range() -> tuple[date, date]:
    """询问用户本次报量的起止日期。"""
    today_date = date.today()
    start_date = parse_cli_date_input(
        input(f"开始日期（直接回车默认{today_date.isoformat()}）："),
        today_date,
    )
    end_date = parse_cli_date_input(
        input(f"结束日期（直接回车默认{start_date.isoformat()}）："),
        start_date,
    )
    if end_date < start_date:
        raise ValueError("结束日期不能早于开始日期。")
    if start_date.year != end_date.year:
        raise ValueError("一次报量请先选择同一年度内的日期范围；跨年度请分两次处理。")
    return start_date, end_date


def confirm_cli_import(start_date: date, end_date: date) -> bool:
    """让用户在处理前确认日期范围。"""
    if start_date == end_date:
        range_text = start_date.isoformat()
    else:
        range_text = f"{start_date.isoformat()} 至 {end_date.isoformat()}"
    print(colorize_cli_text(f"本次导入范围：{range_text}", CliColors.YELLOW))
    confirmation_text = input("确认开始处理？输入Y确认，其他键取消：").strip().lower()
    return confirmation_text in {"y", "yes", "是", "确认"}


def locate_order_csv_path(paths: AutoReportPaths, preferred_order_csv_path: Path | None = None) -> Path:
    """优先读取本次指定CSV，否则自动使用本机最新数据源。"""
    if preferred_order_csv_path is not None:
        if not preferred_order_csv_path.exists():
            raise FileNotFoundError(f"找不到指定订单CSV：{preferred_order_csv_path}")
        return preferred_order_csv_path
    return locate_latest_available_order_csv_path(paths)


def locate_latest_available_order_csv_path(paths: AutoReportPaths) -> Path:
    """查找ERP自动下载或本地模板目录中最新的数据源。"""
    candidate_paths = list(paths.erp_source_data_directory.glob("*.csv"))
    if paths.order_csv_path.exists():
        candidate_paths.append(paths.order_csv_path)
    candidate_paths.extend(paths.source_data_directory.glob("*订单商品明细统计*.csv"))
    candidate_paths.extend(paths.project_root_directory.glob("*订单商品明细统计*.csv"))
    if not candidate_paths:
        raise FileNotFoundError("暂时没有可用的订单商品明细CSV。")
    unique_candidate_paths = list(dict.fromkeys(candidate_paths))
    return max(unique_candidate_paths, key=lambda candidate_path: candidate_path.stat().st_mtime)


def find_latest_erp_downloaded_csv_path(paths: AutoReportPaths) -> Path | None:
    """查找ERP数据源下载目录中最近保存的CSV。"""
    downloaded_csv_paths = list(paths.erp_source_data_directory.glob("*.csv"))
    if not downloaded_csv_paths:
        return None
    return max(
        downloaded_csv_paths,
        key=lambda downloaded_csv_path: downloaded_csv_path.stat().st_mtime,
    )


def validate_annual_template_path(paths: AutoReportPaths, target_year: int) -> None:
    """确认全年模板存在且包含目标年度的12个月工作表。"""
    if not paths.annual_template_workbook_path.exists():
        raise FileNotFoundError(
            f"找不到全年模板：{paths.annual_template_workbook_path}\n"
            "请先运行 tools\\build_v6_4_annual_template.py。"
        )
    template_zip_entries = _read_zip_entries_for_validation(paths.annual_template_workbook_path)
    sheet_paths_by_name = read_workbook_sheet_paths(template_zip_entries)
    expected_sheet_names = {f"{target_year}-{month}" for month in range(1, 13)}
    missing_sheet_names = sorted(expected_sheet_names - set(sheet_paths_by_name))
    if missing_sheet_names:
        raise RuntimeError(f"全年模板缺少工作表：{'、'.join(missing_sheet_names)}")


def _read_zip_entries_for_validation(workbook_path: Path) -> dict[str, bytes]:
    """读取模板内部文件供启动前校验使用。"""
    from zipfile import ZipFile

    with ZipFile(workbook_path, "r") as workbook_zip:
        return {
            entry_name: workbook_zip.read(entry_name)
            for entry_name in workbook_zip.namelist()
        }


def build_unique_result_path(directory_path: Path, file_name: str) -> Path:
    """生成不覆盖旧结果的唯一输出路径。"""
    candidate_path = directory_path / file_name
    if not candidate_path.exists():
        return candidate_path
    file_stem = candidate_path.stem
    file_suffix = candidate_path.suffix
    sequence_number = 2
    while True:
        next_candidate_path = directory_path / f"{file_stem}-{sequence_number}{file_suffix}"
        if not next_candidate_path.exists():
            return next_candidate_path
        sequence_number += 1


def build_result_file_names(start_date: date, end_date: date) -> tuple[str, str, str]:
    """生成Excel、截图和日志文件名。"""
    timestamp_text = datetime.now().strftime("%Y%m%d-%H%M%S")
    range_text = start_date.isoformat() if start_date == end_date else f"{start_date.isoformat()}-至-{end_date.isoformat()}"
    base_name = f"自动报量-v0.01-已导入-{range_text}-{timestamp_text}"
    return f"{base_name}.xlsx", f"{base_name}.png", f"{base_name}.txt"


def build_run_log_text(
    start_date: date,
    end_date: date,
    template_path: Path,
    order_csv_path: Path,
    csv_encoding_name: str,
    output_workbook_path: Path,
    screenshot_path: Path,
    aggregation_result: ReportAggregationResult,
    month_write_results: list[MonthWriteResult],
    status_text: str,
    error_text: str = "",
) -> str:
    """生成一次运行的可读日志。"""
    lines = [
        "【自动报量CLI运行日志】",
        f"状态：{status_text}",
        f"版本：{CLI_VERSION}",
        f"开始日期：{start_date.isoformat()}",
        f"结束日期：{end_date.isoformat()}",
        f"模板：{template_path}",
        f"CSV：{order_csv_path}",
        f"CSV编码：{csv_encoding_name}",
        f"输出Excel：{output_workbook_path}",
        f"结果截图：{screenshot_path}",
        "",
        "【统计】",
        f"CSV行数：{format_cli_number(aggregation_result.total_rows)}",
        f"有效订单：{format_cli_number(aggregation_result.valid_rows)}",
        f"命中订单：{format_cli_number(aggregation_result.matched_rows)}",
        f"未匹配：{format_cli_number(aggregation_result.unmatched_rows)}",
        f"写入数量：{format_cli_number(aggregation_result.written_quantity)}",
        f"过滤行数：{format_cli_number(aggregation_result.filtered_rows)}",
        "",
        "【月份写入】",
    ]
    lines.extend(
        f"{result.sheet_name}：日期{result.target_date_count}天，写入{format_cli_number(result.written_quantity)}件，汇总组{result.summary_group_count}"
        for result in month_write_results
    )
    if aggregation_result.skipped_by_reason:
        lines.extend(["", "【跳过原因】"])
        lines.extend(
            f"{reason}：{format_cli_number(count)}"
            for reason, count in aggregation_result.skipped_by_reason.items()
        )
    if aggregation_result.duplicate_hit_examples:
        lines.extend(["", "【重复映射样例】", *aggregation_result.duplicate_hit_examples])
    if aggregation_result.unmatched_examples:
        lines.extend(["", "【未匹配样例】", *aggregation_result.unmatched_examples])
    if error_text:
        lines.extend(["", "【错误】", error_text])
    return "\n".join(lines) + "\n"


def write_run_log(log_path: Path, log_text: str) -> None:
    """保存运行日志。"""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(log_text, encoding="utf-8")


def open_directory_in_file_explorer(directory_path: Path) -> None:
    """在Windows资源管理器中打开目录。"""
    directory_path.mkdir(parents=True, exist_ok=True)
    start_file_function = getattr(os, "startfile", None)
    if start_file_function is None:
        print(colorize_cli_text(f"当前系统请手动打开目录：{directory_path}", CliColors.YELLOW))
        return
    start_file_function(str(directory_path))


def open_file_in_default_application(file_path: Path) -> None:
    """使用系统默认程序打开文件。"""
    if not file_path.exists():
        raise FileNotFoundError(f"找不到文件：{file_path}")
    start_file_function = getattr(os, "startfile", None)
    if start_file_function is None:
        print(colorize_cli_text(f"当前系统请手动打开文件：{file_path}", CliColors.YELLOW))
        return
    start_file_function(str(file_path))


def reveal_file_in_file_explorer(file_path: Path) -> None:
    """在Windows资源管理器中定位并选中文件。"""
    if not file_path.exists():
        raise FileNotFoundError(f"找不到文件：{file_path}")
    if os.name != "nt":
        open_directory_in_file_explorer(file_path.parent)
        return
    subprocess.Popen(["explorer.exe", f"/select,{file_path}"])


def find_latest_result_workbook_path(paths: AutoReportPaths) -> Path | None:
    """查找最近生成的Excel结果表。"""
    paths.ensure_result_directories()
    result_workbook_paths = list(paths.result_workbook_directory.glob("*.xlsx"))
    if not result_workbook_paths:
        return None
    return max(result_workbook_paths, key=lambda workbook_path: workbook_path.stat().st_mtime)


def run_import_workflow(
    paths: AutoReportPaths,
    selected_date_range: tuple[date, date] | None = None,
    selected_order_csv_path: Path | None = None,
    require_user_confirmation: bool = True,
) -> bool:
    """执行一次从读取到截图的完整报量流程。"""
    paths.ensure_result_directories()
    if selected_date_range is None:
        start_date, end_date = prompt_cli_date_range()
    else:
        start_date, end_date = selected_date_range
    if require_user_confirmation and not confirm_cli_import(start_date, end_date):
        print(colorize_cli_text("已取消，本次没有生成结果。", CliColors.YELLOW))
        input("按回车返回首页。")
        return False
    output_workbook_name, screenshot_name, log_name = build_result_file_names(start_date, end_date)
    output_workbook_path = build_unique_result_path(paths.result_workbook_directory, output_workbook_name)
    screenshot_path = build_unique_result_path(paths.result_screenshot_directory, screenshot_name)
    log_path = build_unique_result_path(paths.result_log_directory, log_name)
    template_path = paths.annual_template_workbook_path
    order_csv_path = paths.order_csv_path
    aggregation_result = ReportAggregationResult()
    month_write_results: list[MonthWriteResult] = []
    csv_encoding_name = "未知"
    try:
        order_csv_path = locate_order_csv_path(paths, selected_order_csv_path)
        validate_annual_template_path(paths, start_date.year)
        report_config = load_runtime_report_config(
            paths.report_config_path,
            paths.runtime_override_config_path(),
        )
        print(colorize_cli_text("正在读取订单CSV…", CliColors.CYAN))
        order_records, csv_encoding_name = read_order_csv_records(order_csv_path, report_config)
        print(colorize_cli_text(f"已读取{len(order_records)}行，正在按日期范围汇总…", CliColors.CYAN))
        aggregation_result = aggregate_order_records(
            order_records,
            report_config,
            start_date,
            end_date,
        )
        print(colorize_cli_text("正在写入全年报量模板…", CliColors.CYAN))
        output_workbook_bytes, month_write_results = build_output_workbook_bytes(
            template_path,
            report_config,
            aggregation_result,
            start_date,
            end_date,
        )
        screenshot_bytes = build_result_page_screenshot_bytes(
            start_date,
            end_date,
            output_workbook_bytes,
        )
        output_workbook_path.write_bytes(output_workbook_bytes)
        write_result_screenshot(screenshot_path, screenshot_bytes)
        success_log_text = build_run_log_text(
            start_date,
            end_date,
            template_path,
            order_csv_path,
            csv_encoding_name,
            output_workbook_path,
            screenshot_path,
            aggregation_result,
            month_write_results,
            "成功",
        )
        write_run_log(log_path, success_log_text)
        print(colorize_cli_text("\n处理成功。", CliColors.GREEN + CliColors.BRIGHT))
        print(f"Excel：{output_workbook_path}")
        print(f"截图：{screenshot_path}")
        print(f"日志：{log_path}")
        if os.environ.get("AUTO_REPORT_NO_OPEN") != "1":
            open_directory_in_file_explorer(paths.result_screenshot_directory)
        workflow_succeeded = True
    except Exception as error:
        error_text = str(error)
        failure_log_text = build_run_log_text(
            start_date,
            end_date,
            template_path,
            order_csv_path,
            csv_encoding_name,
            output_workbook_path,
            screenshot_path,
            aggregation_result,
            month_write_results,
            "失败",
            error_text,
        )
        write_run_log(log_path, failure_log_text)
        print(colorize_cli_text(f"\n处理失败：{error_text}", CliColors.RED + CliColors.BRIGHT))
        print(f"日志：{log_path}")
        workflow_succeeded = False
    input("按回车返回首页。")
    return workflow_succeeded


def run_latest_import_workflow(paths: AutoReportPaths) -> None:
    """按最近3天（含今天）执行一次完整报量流程。"""
    run_import_workflow(paths, build_latest_cli_date_range())


def prompt_erp_credentials() -> ErpCredentials:
    """在CLI中收集ERP登录信息，密码输入不回显。"""
    print(colorize_cli_text("\nERP账号只保存在本机，并由Windows当前用户加密。", CliColors.YELLOW))
    print("  1. 账号登录（常用，手机号/邮箱/云之家）")
    print("  2. 租户登录（备用）")
    login_mode_choice = input("登录方式（直接回车默认1）：").strip() or "1"
    if login_mode_choice == "1":
        login_mode = ERP_LOGIN_MODE_ACCOUNT
        tenant_code = ""
    elif login_mode_choice == "2":
        login_mode = ERP_LOGIN_MODE_TENANT
        tenant_code = input("ERP租户号：").strip()
    else:
        raise ValueError("登录方式请输入1或2。")
    account_name = input("ERP账号：").strip()
    password = read_password_with_delayed_mask(
        "ERP密码（字符显示1秒后变为*）："
    )
    credentials = ErpCredentials(
        login_mode=login_mode,
        account_name=account_name,
        password=password,
        tenant_code=tenant_code,
    )
    credentials.validate()
    return credentials


def configure_erp_credentials(paths: AutoReportPaths, wait_for_return: bool = True) -> ErpCredentials:
    """配置并安全保存ERP账号。"""
    paths.ensure_result_directories()
    credentials = prompt_erp_credentials()
    save_erp_credentials(paths.erp_credentials_path, credentials)
    print(colorize_cli_text("ERP账号/密码已安全保存，下次无需重复输入。", CliColors.GREEN))
    print(colorize_cli_text("无需打开或编辑任何JSON文件。", CliColors.GRAY))
    if wait_for_return:
        input("按回车返回首页。")
    return credentials


def require_erp_credentials(paths: AutoReportPaths) -> ErpCredentials:
    """读取ERP账号；首次使用时自动进入配置。"""
    credentials = load_erp_credentials(paths.erp_credentials_path)
    if credentials is not None:
        return credentials
    print(colorize_cli_text("首次使用一键智能报量，请先配置ERP账号。", CliColors.YELLOW))
    return configure_erp_credentials(paths, wait_for_return=False)


def report_erp_progress(progress_text: str) -> None:
    """在CLI中显示ERP自动化进度。"""
    print(colorize_cli_text(progress_text, CliColors.CYAN))


def report_manual_erp_action_required(message_text: str) -> None:
    """提示ERP需要人工处理，后续由程序自动检测完成状态。"""
    print(colorize_cli_text(f"\n{message_text}", CliColors.YELLOW + CliColors.BRIGHT))
    print(colorize_cli_text("完成后程序会自动继续，请不要关闭本窗口。", CliColors.YELLOW))


def run_one_click_erp_workflow(paths: AutoReportPaths, reference_date: date | None = None) -> None:
    """一键完成ERP下载、最近3天报量和结果截图。"""
    paths.ensure_result_directories()
    try:
        credentials = require_erp_credentials(paths)
        downloaded_order_csv_path = download_order_source_from_erp(
            credentials=credentials,
            browser_profile_directory=paths.erp_browser_profile_directory,
            download_directory=paths.erp_source_data_directory,
            progress_callback=report_erp_progress,
            manual_action_callback=report_manual_erp_action_required,
            reference_date=reference_date,
        )
        print(colorize_cli_text("已使用本次新下载数据，不会叠加旧数据。", CliColors.GREEN))
        run_import_workflow(
            paths,
            selected_date_range=build_latest_cli_date_range(reference_date),
            selected_order_csv_path=downloaded_order_csv_path,
            require_user_confirmation=False,
        )
    except ErpBrowserClosedError as error:
        print(colorize_cli_text(f"\n{error}", CliColors.YELLOW + CliColors.BRIGHT))
        print(colorize_cli_text("已返回首页。请选择第6项修改账号，再选第1项重试。", CliColors.YELLOW))
        return
    except Exception as error:
        print(colorize_cli_text(f"\nERP自动报量未完成：{error}", CliColors.RED + CliColors.BRIGHT))
        print(colorize_cli_text("请使用首页第2或第3项切回本地手动报量，不可漏报。", CliColors.YELLOW))
        input("按回车返回首页。")


def open_configuration_directory(paths: AutoReportPaths) -> None:
    """打开配置目录，供高级用户维护覆盖配置。"""
    paths.ensure_result_directories()
    open_directory_in_file_explorer(paths.runtime_config_directory)
    print(f"配置目录：{paths.runtime_config_directory}")
    input("按回车返回首页。")


def open_latest_result_workbook(paths: AutoReportPaths) -> None:
    """打开最近生成的Excel结果表；暂无结果时打开结果目录。"""
    latest_result_workbook_path = find_latest_result_workbook_path(paths)
    if latest_result_workbook_path is None:
        open_directory_in_file_explorer(paths.result_workbook_directory)
        print(colorize_cli_text("暂时没有结果表，已打开Excel结果文件夹。", CliColors.YELLOW))
    else:
        open_file_in_default_application(latest_result_workbook_path)
        print(f"最新结果表：{latest_result_workbook_path}")
    input("按回车返回首页。")


def open_template_directory(paths: AutoReportPaths) -> None:
    """打开模板和订单源文件所在目录。"""
    open_directory_in_file_explorer(paths.source_data_directory)
    print(f"模板文件夹：{paths.source_data_directory}")
    input("按回车返回首页。")


def open_downloaded_source_data_directory(paths: AutoReportPaths) -> None:
    """打开ERP下载目录；已有数据时直接选中最近的CSV。"""
    paths.ensure_result_directories()
    latest_downloaded_csv_path = find_latest_erp_downloaded_csv_path(paths)
    if latest_downloaded_csv_path is None:
        open_directory_in_file_explorer(paths.erp_source_data_directory)
        print(colorize_cli_text("尚无自动下载的数据源，已打开数据源下载文件夹。", CliColors.YELLOW))
    else:
        reveal_file_in_file_explorer(latest_downloaded_csv_path)
        print(f"最新下载数据源：{latest_downloaded_csv_path}")
    input("按回车返回首页。")


def show_latest_run_log(paths: AutoReportPaths) -> None:
    """显示最近一份运行日志。"""
    paths.ensure_result_directories()
    log_paths = sorted(paths.result_log_directory.glob("*.txt"), key=lambda path: path.stat().st_mtime)
    if not log_paths:
        print(colorize_cli_text("暂时没有处理日志。", CliColors.YELLOW))
    else:
        print(log_paths[-1].read_text(encoding="utf-8"))
    input("按回车返回首页。")


def run_cli_home_loop() -> None:
    """运行CLI首页菜单循环。"""
    enable_windows_ansi_colors()
    paths = build_project_paths()
    while True:
        print_cli_home(paths)
        try:
            menu_choice = input("输入编号：").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n已退出自动报量CLI。")
            return
        try:
            if menu_choice == "1":
                run_one_click_erp_workflow(paths)
            elif menu_choice == "2":
                run_latest_import_workflow(paths)
            elif menu_choice == "3":
                run_import_workflow(paths)
            elif menu_choice == "4":
                open_directory_in_file_explorer(paths.result_screenshot_directory)
                input("按回车返回首页。")
            elif menu_choice == "5":
                open_latest_result_workbook(paths)
            elif menu_choice == "6":
                configure_erp_credentials(paths)
            elif menu_choice == "7":
                open_template_directory(paths)
            elif menu_choice == "8":
                open_downloaded_source_data_directory(paths)
            elif menu_choice == "9":
                show_latest_run_log(paths)
            elif menu_choice == "0":
                print(colorize_cli_text("已退出自动报量CLI。", CliColors.GREEN))
                return
            else:
                print(colorize_cli_text("请输入菜单中的编号。", CliColors.YELLOW))
                input("按回车继续。")
        except (EOFError, KeyboardInterrupt):
            print("\n已退出自动报量CLI。")
            return
        except Exception as error:
            print(colorize_cli_text(f"操作失败：{error}", CliColors.RED))
            input("按回车返回首页。")


if __name__ == "__main__":
    run_cli_home_loop()
