#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import RLock


@dataclass(frozen=True)
class MonitorStats:
    successful_scan_count: int
    last_success_at: float
    updated_at: float


class MonitorStatsStore:
    def __init__(self, path: Path) -> None:
        # 该存储用于持久记录监控成功次数，避免重启后台后统计归零。
        self.path = Path(path)
        self._lock = RLock()
        self._stats = self._load_stats()

    def snapshot(self) -> MonitorStats:
        # 该函数用于给后台状态页读取当前统计快照。
        with self._lock:
            return self._stats

    def mark_success(self) -> MonitorStats:
        # 该函数用于在一轮监控完整成功后累加次数并立即落盘。
        with self._lock:
            now = time.time()
            self._stats = MonitorStats(
                successful_scan_count=self._stats.successful_scan_count + 1,
                last_success_at=now,
                updated_at=now,
            )
            self._save_stats()
            return self._stats

    def _load_stats(self) -> MonitorStats:
        # 该函数用于严格读取统计文件，文件损坏时直接暴露原因方便修根因。
        if not self.path.exists():
            return MonitorStats(successful_scan_count=0, last_success_at=0, updated_at=0)
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8-sig"))
        except Exception as exc:
            raise RuntimeError(f"读取监控统计失败：{self.path}（{type(exc).__name__}: {exc}）") from exc
        if not isinstance(raw, dict):
            raise RuntimeError("读取监控统计失败：根节点必须是对象")
        count = int(raw.get("successful_scan_count") or 0)
        if count < 0:
            raise RuntimeError(f"读取监控统计失败：successful_scan_count 不能小于 0，当前值={count}")
        return MonitorStats(
            successful_scan_count=count,
            last_success_at=float(raw.get("last_success_at") or 0),
            updated_at=float(raw.get("updated_at") or 0),
        )

    def _save_stats(self) -> None:
        # 该函数用于 UTF-8 保存运行统计，和配置文件分离避免污染用户配置。
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1, **asdict(self._stats)}
        self.path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


__all__ = ["MonitorStats", "MonitorStatsStore"]
