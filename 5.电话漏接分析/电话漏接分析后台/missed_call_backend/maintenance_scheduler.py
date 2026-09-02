"""该文件负责运行中定时触发维护，避免长时间运行积累垃圾。"""
from __future__ import annotations

import threading
from collections.abc import Callable

from .logging_utils import write_error_log, write_log
from .runtime_maintenance import run_periodic_maintenance

MAINTENANCE_INTERVAL_SECONDS = 30 * 60


class PeriodicMaintenanceRunner:
    """运行中维护器只负责按时间触发，不参与具体清理规则。"""

    def __init__(
        self,
        maintenance_action: Callable[[], dict[str, int]] = run_periodic_maintenance,
        interval_seconds: float = MAINTENANCE_INTERVAL_SECONDS,
        initial_delay_seconds: float = MAINTENANCE_INTERVAL_SECONDS,
    ) -> None:
        """保存维护器参数，方便测试用短间隔验证真实循环。"""
        self._maintenance_action = maintenance_action
        self._interval_seconds = interval_seconds
        self._initial_delay_seconds = initial_delay_seconds
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """启动后台维护线程，避免重复启动多个扫描线程。"""
        if self.is_running():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, name="runtime-maintenance", daemon=True)
        self._thread.start()
        write_log("启动维护器", "运行数据", f"间隔={int(self._interval_seconds)}秒")

    def stop(self) -> None:
        """通知维护线程退出，避免服务关闭后继续占用资源。"""
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=min(5.0, max(0.1, self._interval_seconds)))
        write_log("停止维护器", "运行数据", "已通知后台维护线程退出")

    def is_running(self) -> bool:
        """判断维护线程是否还活着，测试和重复启动都走同一个判断。"""
        return self._thread is not None and self._thread.is_alive()

    def _run_loop(self) -> None:
        """按固定间隔触发维护，等待期间可被退出信号立即打断。"""
        if self._stop_event.wait(self._initial_delay_seconds):
            return
        while not self._stop_event.is_set():
            self._run_once()
            if self._stop_event.wait(self._interval_seconds):
                return

    def _run_once(self) -> None:
        """执行一次维护，异常只在维护线程最外层记录并跳过本轮。"""
        try:
            self._maintenance_action()
        except Exception as error:
            write_error_log("定时维护失败", "运行数据", error)
