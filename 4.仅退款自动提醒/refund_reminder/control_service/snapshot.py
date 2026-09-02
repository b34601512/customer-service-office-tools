# 该文件用于生成控制面板快照和保存配置表单。
from __future__ import annotations

import time
from dataclasses import asdict
from typing import Any

from ..app_metadata import APP_METADATA
from ..config import app_config_to_dict, save_config
from ..control_form import build_config_from_form, config_to_form_state


class SnapshotMixin:
    def get_snapshot(self) -> dict[str, Any]:
        # 该函数用于输出后台页面所需的完整状态快照。
        with self._lock:
            monitor_stats = self.monitor_stats.snapshot()
            now = time.time()
            runtime = {
                "statusText": self._format_status(),
                "statusPhase": self.status_phase,
                "monitoring": self.monitor_thread is not None and self.monitor_thread.is_alive(),
                "monitorStopRequested": self.monitor_stop_event.is_set(),
                "monitorRestartRequested": self._monitor_restart_requested,
                "nextScanAt": self.next_scan_at,
                "lastScanAt": self.last_scan_at,
                "successfulMonitorCount": monitor_stats.successful_scan_count,
                "lastSuccessfulScanAt": monitor_stats.last_success_at,
                "indicators": {key: self._runtime_indicator_dict(key, value, now) for key, value in self.indicators.items()},
                "workflowSteps": [self._runtime_workflow_step_dict(key, self.workflow_steps[key], now) for key in self.indicators if key in self.workflow_steps],
                "logLines": list(self.log_lines[-300:]),
                "problemOrders": self._build_runtime_order_dicts(self.last_problem_orders),
                "handledOrderCount": self.handled_orders.count(),
            }
        return {
            "ok": True,
            "appMetadata": asdict(APP_METADATA),
            "form": self.get_form_state(),
            "runtime": runtime,
        }

    def _runtime_indicator_dict(self, key: str, value: Any, now: float) -> dict[str, Any]:
        # 该函数只在输出快照时刷新自动监控倒计时，不污染后台长期保存的状态。
        item = asdict(value)
        if key == "monitor":
            item["detail"] = self._format_monitor_runtime_detail(item.get("detail", ""), now)
        return item

    def _runtime_workflow_step_dict(self, key: str, value: Any, now: float) -> dict[str, Any]:
        # 该函数让流程树里的自动监控节点显示实时倒计时，顶部状态不再重复显示。
        item = asdict(value)
        if key == "monitor":
            item["detail"] = self._format_monitor_runtime_detail(item.get("detail", ""), now)
        return item

    def get_form_state(self) -> dict[str, Any]:
        # 该函数用于把当前配置转成前端表单状态。
        return config_to_form_state(self.config)

    def save_form(self, payload: dict[str, Any]) -> dict[str, Any]:
        # 该函数用于保存控制面板提交的配置。
        self.config = build_config_from_form(self.config, payload)
        save_config(self.config_path, self.config)
        self._append_log("配置已保存。")
        return app_config_to_dict(self.config)


__all__ = ["SnapshotMixin"]
