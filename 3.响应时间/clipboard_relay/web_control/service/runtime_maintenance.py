#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import threading

from ...runtime_cleanup import DEFAULT_RUNTIME_BLOAT_POLICY, RuntimeBloatPolicy, cleanup_live_runtime_bloat


def _format_cleanup_message(moved_count: int) -> str:
    # 该函数用于把自动清理结果转成用户能看懂的一句话，避免暴露内部路径细节。
    return f"已自动处理运行膨胀：{moved_count} 项运行产物已搬到备份文件夹。"


def _run_runtime_maintenance_once(self, *, policy: RuntimeBloatPolicy = DEFAULT_RUNTIME_BLOAT_POLICY) -> list[object]:
    # 该函数用于执行一次运行膨胀体检，只把结果反馈给网页后台。
    moved = cleanup_live_runtime_bloat(self.config_path.parent, policy=policy)
    if moved:
        self._append_log(_format_cleanup_message(len(moved)))
    return list(moved)


def _start_runtime_maintenance_watcher(self, *, policy: RuntimeBloatPolicy = DEFAULT_RUNTIME_BLOAT_POLICY) -> None:
    # 该函数用于启动低频运行体检线程，避免缓存和日志在长时间运行中拖慢程序。
    def _worker() -> None:
        while not self.shutdown_event.wait(float(policy.maintenance_interval_sec)):
            try:
                self._run_runtime_maintenance_once(policy=policy)
            except Exception as exc:
                self._append_log(f"运行膨胀体检失败：{exc}")

    threading.Thread(target=_worker, name="runtime-maintenance", daemon=True).start()


__all__ = ["_run_runtime_maintenance_once", "_start_runtime_maintenance_watcher"]
