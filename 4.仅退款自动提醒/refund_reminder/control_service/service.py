# 该文件用于装配控制服务，主类只负责持有状态并组合各动作模块。
from __future__ import annotations

import threading
from pathlib import Path

from ..config import load_config
from ..erp_page import ErpBrowser
from ..handled_orders import HandledOrderStore
from ..monitor_stats import MonitorStatsStore
from ..order_detector import ProblemOrder
from ..runtime_maintenance import build_runtime_layout
from ..system_notifier import send_order_system_notification
from .detection_summary import DetectionSummaryMixin
from .logging_state import LoggingStateMixin
from .order_actions import OrderActionsMixin
from .scanned_orders import ScannedOrdersMixin
from .snapshot import SnapshotMixin
from .thread_actions import ThreadActionsMixin
from .types import Indicator, WorkflowStep
from .workers import WorkersMixin


class ControlService(
    SnapshotMixin,
    ThreadActionsMixin,
    OrderActionsMixin,
    WorkersMixin,
    ScannedOrdersMixin,
    DetectionSummaryMixin,
    LoggingStateMixin,
):
    def __init__(self, *, config_path: Path) -> None:
        # 该服务统一管理后台状态、ERP 浏览器和定时监控线程。
        self.config_path = Path(config_path)
        self.runtime_layout = build_runtime_layout(self.config_path.parent)
        self.config = load_config(self.config_path)
        self.browser = ErpBrowser(profile_root=self.runtime_layout.browser_profiles_dir)
        self.shutdown_event = threading.Event()
        self.exiting = False
        self.monitor_stop_event = threading.Event()
        self.monitor_thread: threading.Thread | None = None
        self._monitor_restart_requested = False
        self.open_thread: threading.Thread | None = None
        self._lock = threading.RLock()
        self.log_lines: list[str] = []
        self._log_line_keys: list[str] = []
        self.run_log_path = self._prepare_run_log_file()
        self._last_polling_log_by_kind: dict[str, str] = {}
        self._last_detection_summary_signature = ""
        self._last_handled_filter_signature = ""
        self.notification_sender = send_order_system_notification
        self.handled_orders = HandledOrderStore(self.runtime_layout.handled_orders_path, archive_root=self.runtime_layout.handled_orders_archive_dir)
        self.monitor_stats = MonitorStatsStore(self.runtime_layout.monitor_stats_path)
        self.indicators: dict[str, Indicator] = {
            "browser": Indicator("ERP浏览器", "idle", "尚未打开 ERP。"),
            "monitor": Indicator("自动监控", "idle", "尚未启动自动监控。"),
            "scan": Indicator("订单查询", "idle", "尚未查询。"),
            "alert": Indicator("提醒状态", "idle", "尚未发现需要提醒的订单。"),
            "stats": Indicator("累计监控", "idle", self._format_monitor_stats_detail()),
        }
        self.workflow_steps: dict[str, WorkflowStep] = {
            key: WorkflowStep(key, item.title, item.state, item.detail, 0.0)
            for key, item in self.indicators.items()
        }
        self.status_phase = "待命"
        self.next_scan_at: float | None = None
        self.last_scan_at: float | None = None
        self.last_problem_orders: tuple[ProblemOrder, ...] = ()
        self._append_log("后台已待命。先打开 ERP 并完成登录，再启动自动监控。")
        if self.config.monitor.auto_start_monitor:
            try:
                self.start_monitor(source="后台启动配置：auto_start_monitor")
            except RuntimeError as exc:
                self._append_log(f"自动启动监控已跳过：{exc}")


__all__ = ["ControlService"]
