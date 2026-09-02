# 该文件用于清理本工具托管的 ERP 浏览器进程。
from __future__ import annotations

from pathlib import Path

from ..logger import log
from ..process_cleanup import stop_processes_matching_paths
from ..runtime_maintenance import clean_browser_profile_cache
from .constants import MODULE_NAME


class BrowserProcessMixin:
    def force_kill_managed_browsers(self) -> None:
        # 该函数用于按本工具资料目录强制清理浏览器，不触碰用户普通浏览器。
        killed = self._kill_processes_matching_path(self.profile_root)
        if killed:
            log("Browser", "强制清理受控浏览器", MODULE_NAME, "force_kill_managed_browsers", profile=str(self.profile_root), pids=",".join(killed))
        clean_browser_profile_cache(self.profile_root)
        self._thread = None

    def _close_stale_profile_processes(self, user_data_dir: Path) -> None:
        # 该函数用于打开 ERP 前清理同资料目录残留浏览器。
        killed = self._kill_processes_matching_path(user_data_dir)
        if killed:
            log("Browser", "清理残留ERP浏览器", MODULE_NAME, "_close_stale_profile_processes", profile=str(user_data_dir), pids=",".join(killed))

    @staticmethod
    def _kill_processes_matching_path(path: Path) -> list[str]:
        # 该函数用于按命令行里的资料目录精准清理进程，避免误杀普通浏览器。
        return stop_processes_matching_paths([path], action="清理受控浏览器")


__all__ = ["BrowserProcessMixin"]
