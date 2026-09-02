"""该文件负责电话漏接分析 CLI 的菜单和业务操作。"""
from __future__ import annotations

import signal
import sys
import threading
import uuid
from datetime import timedelta
from typing import Any, Callable

from . import cli_config_actions
from .browser_control import (
    begin_startup_cleanup,
    close_download_browser_windows,
    mark_startup_cleanup_done,
)
from .cli_data import (
    CachedCallRecords,
    build_daily_trend_rows,
    build_filtered_agent_summary,
    filter_cached_records,
    filter_agents_for_comparison,
    filter_trend_rows_by_dates,
    earliest_result_day,
    latest_result_day,
    load_cached_call_records,
    load_latest_result,
    range_label,
)
from .cli_display import (
    colorize,
    clear_screen,
    configure_terminal,
    highlight_number,
    highlight_queue_loss,
    print_menu,
    print_message,
    print_progress_bar,
    print_table,
    print_title,
    render_bar,
    build_daily_trend_table_rows,
    shorten_text,
)
from .cli_input import format_rate, prompt_text, wait_for_enter
from .download_tasks import (
    DOWNLOAD_TASKS,
    find_active_auto_download_task,
    run_auto_download_task,
)
from .logging_utils import write_log
from .maintenance_scheduler import PeriodicMaintenanceRunner
from .normalizers import format_seconds
from .runtime_maintenance import ensure_runtime_directories, reset_runtime_log, run_startup_maintenance
from .raw_table_store import RAW_TABLE_FILE_KEYS, result_raw_tables
from .state_store import load_download_config
from .tui_app import TuiApp
from .tui_pages import create_pages


class CliApplication:
    """单一 CLI 管理流程，所有业务状态仍来自现有后端模块。"""

    def __init__(self) -> None:
        self.latest_result: dict[str, Any] | None = None
        self.cached_call_records: CachedCallRecords | None = None
        self._raw_tables_confirmed = False
        self.maintenance_runner: PeriodicMaintenanceRunner | None = None
        self.is_running = True
        self.signal_handlers: dict[int, Any] = {}

    def run(self) -> None:
        """启动 CLI、进入菜单并确保退出时完成清理。"""
        configure_terminal()
        self.prepare_runtime()
        self.register_exit_signals()
        try:
            self.refresh_result()
            if sys.stdout.isatty():
                self.run_tui()
            else:
                self.main_menu_loop()
        except KeyboardInterrupt:
            print_message("收到退出请求，正在清理后台资源...", "warning")
        finally:
            self.cleanup_runtime()

    def run_tui(self) -> None:
        """启动全屏 TUI，方向键/数字键切换页面，回车执行。"""
        pages = create_pages()
        app = TuiApp(
            "电话漏接分析",
            pages,
            self,
            status_provider=self._tui_status_lines,
        )
        app.run()

    def _tui_status_lines(self, tui_app: TuiApp) -> list[str]:
        """生成 TUI 顶部两行状态摘要。"""
        result = self.latest_result
        if not result:
            return ["暂无分析结果，请到“下载”页执行下载并分析。", ""]
        summary = result.get("summary") or {}
        cache = result.get("latestDownloadCache") or {}
        return [
            f"呼损 {summary.get('lossRows', 0)}｜呼入 {summary.get('inboundRows', 0)}｜呼出 {summary.get('outboundRows', 0)}",
            f"最新分析 {cache.get('savedAt') or '无'}｜共 {len(tui_app.pages)} 个页面，方向键/数字键切换",
        ]

    def prepare_runtime(self) -> None:
        """快速完成目录准备，耗时清理放到后台，避免 TUI 启动等待。"""
        reset_runtime_log()
        ensure_runtime_directories()
        threading.Thread(target=self._startup_cleanup_background, daemon=True).start()
        self.maintenance_runner = PeriodicMaintenanceRunner()
        self.maintenance_runner.start()

    def _startup_cleanup_background(self) -> None:
        """在后台执行浏览器清理和启动维护，不阻塞 TUI 首屏。

        下载任务与清理共用下载浏览器 profile，必须先标记清理开始再执行，
        让下载任务等待清理完成，避免清理线程把下载中的浏览器误杀。
        """
        begin_startup_cleanup()
        try:
            close_download_browser_windows()
            run_startup_maintenance()
        except Exception as error:
            write_log("启动清理失败", "CLI", str(error))
        finally:
            mark_startup_cleanup_done()

    def register_exit_signals(self) -> None:
        """让 Ctrl+C 和系统终止信号进入统一退出路径。"""
        for signal_number in (signal.SIGINT, getattr(signal, "SIGTERM", signal.SIGINT)):
            try:
                self.signal_handlers[signal_number] = signal.getsignal(signal_number)
                signal.signal(signal_number, self.handle_exit_signal)
            except (OSError, ValueError):
                continue

    def handle_exit_signal(self, signal_number: int, _frame: Any) -> None:
        """收到退出信号后让主循环结束。"""
        write_log("退出后台", "CLI", f"收到信号={signal_number}")
        self.is_running = False
        raise KeyboardInterrupt

    def cleanup_runtime(self) -> None:
        """停止维护线程并关闭本程序启动的浏览器。"""
        if self.maintenance_runner:
            self.maintenance_runner.stop()
        close_download_browser_windows()
        write_log("退出后台", "CLI", "已清理本程序打开的浏览器窗口")

    def refresh_result(self) -> None:
        """读取最新结果；原始行已包含在结果中，不再二次打开 Excel。"""
        self.latest_result = load_latest_result()
        self.cached_call_records = None
        self._raw_tables_confirmed = False

    def load_raw_table(self, table_key: str) -> list[dict[str, Any]] | None:
        """从当前结果读取某张原始表；页面与统计共用这一份内存数据。"""
        if not self.latest_result:
            return None
        if table_key not in RAW_TABLE_FILE_KEYS:
            raise ValueError(f"未知原始表：{table_key}")
        return result_raw_tables(self.latest_result)[table_key]

    def require_result(self) -> dict[str, Any] | None:
        """保证当前菜单操作有可用分析结果。"""
        if self.latest_result:
            return self.latest_result
        print_message("暂无分析结果，请先选择“下载并分析”。", "warning")
        return None

    def print_result_summary(self, result: dict[str, Any]) -> None:
        """显示当前结果的核心数量。"""
        summary = result.get("summary") or {}
        cache = result.get("latestDownloadCache") or {}
        print_table(
            ["项目", "数量"],
            [
                ["下载时间", cache.get("savedAt") or result.get("latestRecord", {}).get("savedAt", "无")],
                ["呼损记录", summary.get("lossRows", 0)],
                ["呼入记录", summary.get("inboundRows", 0)],
                ["呼出记录", summary.get("outboundRows", 0)],
            ],
        )

    def main_menu_loop(self) -> None:
        """循环显示主菜单，所有功能从一个入口进入。"""
        menu_items = [
            ("1", "客服统计"),
            ("2", "趋势分析"),
            ("3", "下载并分析"),
            ("4", "配置"),
            ("0", "退出"),
        ]
        while self.is_running:
            print_title("主菜单")
            print_message("作者：黎路遥 ｜ 微信：luyao2089 ｜ 官网：luyao2089.cc", "muted")
            print_message("版权所有 © 黎路遥，保留所有权利", "muted")
            if self.latest_result:
                summary = self.latest_result.get("summary") or {}
                print_message(
                    f"呼损 {summary.get('lossRows', 0)}｜呼入 {summary.get('inboundRows', 0)}｜呼出 {summary.get('outboundRows', 0)}｜"
                    f"最新分析 {((self.latest_result.get('latestDownloadCache') or {}).get('savedAt') or '无')}",
                    "muted",
                )
            print_menu(menu_items)
            choice = prompt_text("请选择：", "0")
            try:
                self.handle_main_choice(choice)
            except KeyboardInterrupt:
                raise
            except Exception as error:
                print_message(str(error), "error")

    def handle_main_choice(self, choice: str) -> None:
        """分发主菜单选项。"""
        clear_screen()
        actions: dict[str, Callable[[], None]] = {
            "1": self.show_agents,
            "2": self.show_trends,
            "3": self.start_download_and_analyze,
            "4": self.show_config_menu,
            "0": self.request_exit,
        }
        action = actions.get(choice)
        if action:
            action()
        else:
            print_message("没有这个菜单选项。", "warning")

    def request_exit(self) -> None:
        """请求离开主菜单。"""
        self.is_running = False

    def show_trends(self) -> None:
        """显示按下载配置天数的呼损趋势和核心指标汇总，不做任何过滤。"""
        result = self.require_result()
        if not result:
            return
        latest_day = latest_result_day(result)
        if not latest_day:
            print_message("暂无趋势数据。", "warning")
            wait_for_enter("按回车返回主菜单...")
            return
        days = int(load_download_config().get("days") or 90)
        start_day = latest_day - timedelta(days=max(0, days - 1))
        rows = filter_trend_rows_by_dates(result, start_day, latest_day)
        print_title("趋势分析", f"近{days}天 {start_day.isoformat()} 至 {latest_day.isoformat()}")
        print_table(
            ["指标", f"近{days}天合计"],
            [
                ["呼入", int(sum(float(row.get("inboundCount") or 0) for row in rows))],
                ["呼出", int(sum(float(row.get("outboundCount") or 0) for row in rows))],
                ["呼损", highlight_number(int(sum(float(row.get("lossCount") or 0) for row in rows)))],
                ["IVR呼损", highlight_number(int(sum(float(row.get("ivrLossCount") or 0) for row in rows)))],
                ["排队呼损", highlight_queue_loss(int(sum(float(row.get("queueLossCount") or 0) for row in rows)))],
            ],
        )
        daily_rows = build_daily_trend_rows(
            rows,
            "lossCount",
            "lossRate",
            detail_value_keys=("ivrLossCount", "queueLossCount"),
        )
        daily_table_rows = build_daily_trend_table_rows(
            daily_rows,
            detail_value_keys=("ivrLossCount", "queueLossCount"),
            bar_key="queueLossCount",
        )
        for daily_row in daily_table_rows:
            daily_row[2] = highlight_number(daily_row[2])
            daily_row[3] = highlight_queue_loss(daily_row[3])
            daily_row[4] = colorize(daily_row[4], "red")
        print_table(
            ["日期", "呼损", "IVR呼损", "排队呼损", "趋势条", "较前日", "呼损率"],
            reversed(daily_table_rows),
        )
        wait_for_enter("按回车返回主菜单...")

    def ensure_cached_records(self) -> CachedCallRecords:
        """按需读取最新记录中的三份原始报表。"""
        result = self.require_result()
        if not result:
            raise RuntimeError("暂无分析结果")
        if self.cached_call_records is None:
            self.cached_call_records = load_cached_call_records(result)
        return self.cached_call_records

    def show_agents(self) -> None:
        """显示全部时间范围的客服统计，不做任何过滤。"""
        result = self.require_result()
        if not result:
            return
        latest_day = latest_result_day(result)
        filtered_records = filter_cached_records(self.ensure_cached_records(), 0, latest_day)
        agents = build_filtered_agent_summary(filtered_records)
        comparison_agents = sorted(filter_agents_for_comparison(agents, "1"), key=lambda item: (float(item.get("totalContactCount") or 0), float(item.get("totalTalkSeconds") or 0)), reverse=True)
        print_title("客服统计（全部范围）", range_label(0, latest_day, earliest_result_day(result)))
        self.print_agent_kpis(agents)
        self.print_agent_comparison(comparison_agents)
        sorted_agents = sorted(agents, key=lambda item: (float(item.get("totalContactCount") or 0), float(item.get("totalTalkSeconds") or 0)), reverse=True)
        print_message("\n综合通话量排行（柱状条=总通话次数，按综合维度排序）", "bold")
        maximum = max([float(item.get("totalContactCount") or 0) for item in comparison_agents] or [1])
        for agent in comparison_agents:
            value = float(agent.get("totalContactCount") or 0)
            print(f"{shorten_text(agent.get('agentName') or '未填写', 14):<14} {colorize(render_bar(value, maximum), 'blue')} {int(value)}次")
        print_table(
            ["分机", "客服", "呼入", "接通", "呼入率", "呼出", "接通", "呼出率", "外呼时长", "总时长"],
            [
                [
                    "、".join(agent.get("extensions") or []) or "未识别",
                    agent.get("agentName", ""),
                    agent.get("inboundCount", 0),
                    agent.get("successfulInboundCount", 0),
                    format_rate(agent.get("inboundSuccessRate", 0)),
                    agent.get("outboundCount", 0),
                    agent.get("successfulOutboundCount", 0),
                    format_rate(agent.get("outboundSuccessRate", 0)),
                    agent.get("outboundTalkText", "0秒"),
                    agent.get("totalTalkText", "0秒"),
                ]
                for agent in sorted_agents
            ],
        )
        wait_for_enter("按回车返回主菜单...")

    def print_agent_kpis(self, agents: list[dict[str, Any]]) -> None:
        """显示客服统计核心指标。"""
        inbound_total = sum(float(agent.get("inboundCount") or 0) for agent in agents)
        outbound_total = sum(float(agent.get("outboundCount") or 0) for agent in agents)
        inbound_success = sum(float(agent.get("successfulInboundCount") or 0) for agent in agents)
        outbound_success = sum(float(agent.get("successfulOutboundCount") or 0) for agent in agents)
        total_talk = sum(float(agent.get("totalTalkSeconds") or 0) for agent in agents)
        values = [["座席数", len(agents), "总通话", int(inbound_total + outbound_total), "总接通", int(inbound_success + outbound_success), "总通话时长", format_seconds(total_talk)]]
        print_table([str(item) for item in values[0][::2]], [values[0][1::2]])

    def print_agent_comparison(self, agents: list[dict[str, Any]]) -> None:
        """打印综合维度的客服冠军对比。"""
        if not agents:
            return
        comparisons = [
            ("总通话最多", "totalContactCount", "次"),
            ("总接通最多", "successfulContactCount", "次"),
            ("总通话最长", "totalTalkSeconds", "秒"),
            ("综合成功率最高", "successRate", "%"),
        ]
        print_message("\n客服对比", "bold")
        for label, key, suffix in comparisons:
            champion = max(agents, key=lambda item: float(item.get(key) or 0))
            value = champion.get(key) or 0
            if suffix == "%":
                value_text = format_rate(value)
            elif suffix == "秒":
                value_text = format_seconds(value)
            else:
                value_text = f"{int(float(value))}{suffix}"
            print(f"{label:<16} {shorten_text(champion.get('agentName') or '未填写', 14):<14} {colorize(value_text, 'blue')}")

    def show_config_menu(self) -> None:
        """集中管理下载、座席、投诉、口径等低频配置。"""
        cli_config_actions.show_config_menu(self)

    def start_download_and_analyze(self) -> None:
        """启动现有自动下载引擎并等待状态完成。"""
        active_task = find_active_auto_download_task()
        if active_task:
            print_message("已有自动下载正在运行，请先等待它完成。", "warning")
            return
        task_id = uuid.uuid4().hex
        DOWNLOAD_TASKS[task_id] = {"status": "queued", "message": "任务已提交", "stage": "创建任务", "progress": 3, "logs": []}
        worker = threading.Thread(target=run_auto_download_task, args=(task_id,), daemon=True)
        worker.start()
        last_log_count = 0
        last_progress = -1
        last_message = ""
        while True:
            task = DOWNLOAD_TASKS.get(task_id, {})
            logs = task.get("logs") or []
            for line in logs[last_log_count:]:
                print(line)
            last_log_count = len(logs)
            current_progress = int(task.get("progress") or 0)
            current_message = str(task.get("message") or "自动下载中")
            if current_progress != last_progress or current_message != last_message:
                print_progress_bar(current_progress, current_message)
                last_progress = current_progress
                last_message = current_message
            status = task.get("status")
            if status in {"done", "error"}:
                break
            worker.join(timeout=0.5)
        close_download_browser_windows()
        if task.get("status") == "done":
            self.refresh_result()
            print_message("下载并分析完成。", "success")
            if self.latest_result:
                self.print_result_summary(self.latest_result)
        else:
            print_message(str(task.get("message") or "下载并分析失败"), "error")
        wait_for_enter("按回车返回...")

    def edit_download_config(self) -> None:
        """修改网页原配置面板中的下载配置。"""
        cli_config_actions.edit_download_config(self)

    def open_original_login(self) -> None:
        """打开原系统并复用现有登录态。"""
        cli_config_actions.open_original_login(self)

    def show_recent_log(self) -> None:
        """显示当前运行日志末尾，保留网页日志面板的用途。"""
        cli_config_actions.show_recent_log(self)

    def edit_agent_mapping(self) -> None:
        """编辑座席分机到当前姓名的映射。"""
        cli_config_actions.edit_agent_mapping(self)

    def edit_complaint_config(self) -> None:
        """编辑投诉电话对应的座席分机。"""
        cli_config_actions.edit_complaint_config(self)

    def show_rules(self) -> None:
        """显示当前项目的判断口径。"""
        cli_config_actions.show_rules(self)
