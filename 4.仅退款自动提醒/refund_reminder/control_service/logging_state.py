# 该文件用于处理控制服务的运行日志、阶段和状态卡更新。
from __future__ import annotations

import time
from dataclasses import replace
from pathlib import Path

from ..logger import log
from ..monitor_stats import MonitorStats
from .constants import MODULE_NAME, RUN_LOG_FILENAME


class LoggingStateMixin:
    def _set_indicator(self, key: str, state: str, detail: str) -> None:
        with self._lock:
            current = self.indicators[key]
            self.indicators[key] = replace(current, state=str(state), detail=str(detail))
            step = self.workflow_steps.get(key)
            if step is not None:
                self.workflow_steps[key] = replace(step, state=str(state), detail=str(detail), updated_at=time.time())
        log("Panel", "状态", MODULE_NAME, "_set_indicator", key=key, state=state, detail=detail)

    def _set_phase(self, phase: str) -> None:
        with self._lock:
            self.status_phase = str(phase)
        log("Panel", "阶段", MODULE_NAME, "_set_phase", phase=phase)

    def _append_log(self, message: str) -> None:
        text = str(message or "")
        dedupe_key = self._polling_log_dedupe_key(text)
        line = f"{time.strftime('%H:%M:%S')} {text}"
        with self._lock:
            self._sync_log_line_keys()
            if dedupe_key and self._last_polling_log_by_kind.get(dedupe_key) == text:
                return
            if dedupe_key:
                self._last_polling_log_by_kind[dedupe_key] = text
                replaced = self._replace_log_line(dedupe_key, line)
                if replaced:
                    self._rewrite_run_log_file()
                else:
                    self._add_log_line(dedupe_key, line)
                    self._write_run_log_line(line)
            else:
                self._add_log_line("", line)
                self._write_run_log_line(line)
        log("Panel", "日志", MODULE_NAME, "_append_log", message=text)

    def _append_scan_progress(self, message: str) -> None:
        # 该函数把浏览器扫描内部进度同步到主页面，避免用户只看到“进行中”却不知道卡在哪一步。
        text = str(message or "")
        if text:
            self._set_indicator("scan", "running", text)
        self._append_log(text)

    def _add_log_line(self, key: str, line: str) -> None:
        # 该函数同步维护日志行和日志类型，避免裁剪日志时类型索引错位。
        self.log_lines.append(line)
        self._log_line_keys.append(key)
        if len(self.log_lines) > 2000:
            overflow = len(self.log_lines) - 2000
            self.log_lines = self.log_lines[overflow:]
            self._log_line_keys = self._log_line_keys[overflow:]

    def _sync_log_line_keys(self) -> None:
        # 该函数兼容测试或维护代码直接清理 log_lines 的场景，避免日志类型索引残留。
        if len(getattr(self, "_log_line_keys", [])) != len(self.log_lines):
            self._log_line_keys = [""] * len(self.log_lines)

    def _replace_log_line(self, key: str, line: str) -> bool:
        # 该函数把同一个轮询检测动作刷新到原位置，避免实时日志被等待状态刷屏。
        keys = getattr(self, "_log_line_keys", [])
        for index in range(len(keys) - 1, -1, -1):
            if index < len(self.log_lines) and keys[index] == key:
                self.log_lines[index] = line
                return True
        return False

    def _prepare_run_log_file(self) -> Path:
        # 该函数在后台启动时清空固定日志文件，只保留本次运行的实时日志。
        logs_dir = self.config_path.parent / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        path = logs_dir / RUN_LOG_FILENAME
        path.write_text("", encoding="utf-8")
        return path

    def _write_run_log_line(self, line: str) -> None:
        # 该函数把后台实时日志同步写入本次运行日志，方便复制给外部工具分析。
        with self.run_log_path.open("a", encoding="utf-8") as handle:
            handle.write(str(line or "") + "\n")

    def _rewrite_run_log_file(self) -> None:
        # 该函数在轮询状态刷新同一行时同步重写固定日志文件，保证文件日志也不刷屏。
        self.run_log_path.write_text("\n".join(self.log_lines) + ("\n" if self.log_lines else ""), encoding="utf-8")

    @staticmethod
    def _polling_log_dedupe_key(message: str) -> str:
        # 该函数只给轮询状态日志做去重，业务动作日志不能吞。
        text = str(message or "")
        if text.startswith(("检测到登录等待页", "等待订单查询页", "已尝试从首页菜单进入订单查询页")):
            return "订单页等待"
        if text.startswith("订单页识别状态"):
            return "订单页识别状态"
        return ""

    def _format_status(self) -> str:
        # 该函数用于生成前端顶部状态文案，倒计时只放在自动监控节点里，避免页面重复显示。
        return f"{self.status_phase}｜最近扫描：{self._format_time(self.last_scan_at)}"

    def _format_next_scan_remaining(self, now: float | None = None) -> str:
        # 该函数用于按下一轮扫描时间生成实时倒计时，所有页面展示都从 next_scan_at 计算。
        if not self.next_scan_at:
            return ""
        current = time.time() if now is None else float(now)
        if self.next_scan_at <= current:
            return ""
        remaining = max(0, int(self.next_scan_at - current))
        return f"约 {remaining // 60}分{remaining % 60}秒后"

    def _format_monitor_runtime_detail(self, fallback_detail: str, now: float | None = None) -> str:
        # 该函数用于把自动监控节点详情改成实时倒计时，避免固定“5分钟后”误导用户。
        remaining = self._format_next_scan_remaining(now)
        if remaining:
            return f"等待下一次自动查询：{remaining}。"
        return str(fallback_detail or "")

    def _format_monitor_stats_detail(self, stats: MonitorStats | None = None) -> str:
        # 该函数用于把累计监控统计转成后台状态卡文案。
        item = stats or self.monitor_stats.snapshot()
        return f"累计成功监控 {item.successful_scan_count} 次，最近成功：{self._format_time(item.last_success_at)}。"

    @staticmethod
    def _format_time(timestamp: float | None) -> str:
        # 该函数用于把时间戳转成控制面板可读时间。
        if not timestamp:
            return "暂无"
        item = time.localtime(timestamp)
        return f"{item.tm_year}年{item.tm_mon}月{item.tm_mday}日{time.strftime('%H:%M:%S', item)}"


__all__ = ["LoggingStateMixin"]
