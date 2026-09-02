"""TUI 下载页。"""
from __future__ import annotations

import re
import threading
import uuid
from typing import Any

from ..cli_display import colorize, render_bar, spinner_frame
from ..download_tasks import DOWNLOAD_TASKS, find_active_auto_download_task, run_auto_download_task
from ..tui_app import Page

# 自动化脚本日志形如 [HH:MM:SS][file.js:行][主线:自动下载][动作][消息]。
# 页面文本转储、等待诊断、末尾 JSON 等噪音行不匹配该格式，会被过滤掉。
_AUTOMATION_LOG = re.compile(r"^\[(\d{2}:\d{2}:\d{2})\]\[[^\]]+\]\[[^\]]*\]\[([^\]]*)\](?:\[(.*)\])?$")
# 这类动作只是轮询/诊断，对用户是噪音，下载页不展示。
_NOISY_ACTIONS = {"等待状态", "等待诊断"}


def _clean_log_line(line: str) -> str | None:
    """把自动化日志行转成简短可读的动作行；噪音行返回 None。"""
    match = _AUTOMATION_LOG.match(line)
    if not match:
        return None
    action = match.group(2)
    detail = match.group(3) or ""
    if action in _NOISY_ACTIONS:
        return None
    if action == "页面导出":
        detail = detail.split(" href=")[0]
    elif action == "下载完成":
        detail = detail.split("=")[-1].replace("\\", "/").split("/")[-1]
    if not detail:
        return None
    return f"{action} {detail}"


def _clean_log_lines(lines: list[str]) -> list[str]:
    return [cleaned for line in lines if (cleaned := _clean_log_line(line)) is not None]


class DownloadPage(Page):
    key = "7"
    title = "下载"
    # 下载任务在后台线程运行，需要空闲时也持续刷新显示进度。
    periodic_refresh = True

    def __init__(self) -> None:
        super().__init__()
        self.state.update(task_id=None, started=False, finished=False, message="")

    def on_enter(self, app: Any) -> None:
        if not self.state.get("started"):
            self.state["task_id"] = None
            self.state["finished"] = False
            self.state["message"] = ""

    def render(self, app: Any) -> list[str]:
        lines: list[str] = []
        if not self.state.get("started"):
            active = find_active_auto_download_task()
            if active:
                lines.append(colorize(f"{spinner_frame()} 已有自动下载正在运行，请稍候...", "yellow"))
            else:
                lines.append(colorize("按回车开始下载并分析", "brightBlue"))
                if app.application.latest_result:
                    summary = app.application.latest_result.get("summary") or {}
                    lines.append(
                        colorize(
                            f"当前已有分析：候选 {summary.get('candidateCount', 0)}，待处理 {summary.get('pendingFollowupCount', 0)}",
                            "muted",
                        )
                    )
            return lines

        task_id = self.state.get("task_id")
        task = DOWNLOAD_TASKS.get(task_id, {}) if task_id else {}
        status = task.get("status")

        # 进度行：进度条 + 百分比 + 当前阶段
        progress = int(task.get("progress") or 0)
        stage = str(task.get("stage") or "下载中")
        bar = render_bar(progress, 100, width=20)
        lines.append(colorize(f"[{bar}]  {progress:>3}%   {spinner_frame()} {stage}", "brightCyan"))

        if status == "done" and not self.state.get("finished"):
            self.state["finished"] = True
            app.application.refresh_result()
            self.state["message"] = "下载并分析完成。"
        if status == "error" and not self.state.get("finished"):
            self.state["finished"] = True
            self.state["message"] = str(task.get("message") or "下载并分析失败")

        if status == "done":
            lines.append("")
            lines.append(colorize("✓ 下载并分析完成", "success"))
            result = app.application.latest_result or {}
            summary = result.get("summary") or {}
            downloaded = result.get("downloadedFiles") or {}
            details: list[str] = []
            if downloaded.get("startDate"):
                details.append(f"期间 {downloaded.get('startDate')} 至 {downloaded.get('endDate', '')}")
            if summary.get("candidateCount") is not None:
                details.append(f"候选 {summary.get('candidateCount')} 个号码")
            if details:
                lines.append(colorize("  " + "　".join(details), "muted"))
            lines.append(colorize("按回车返回首页", "muted"))
            return lines
        if status == "error":
            lines.append("")
            lines.append(colorize(f"✗ {self.state.get('message') or '下载并分析失败'}", "error"))
            lines.append(colorize("按回车返回首页", "muted"))
            return lines

        # 下载中：只展示最近关键步骤（过滤噪音日志）
        events = _clean_log_lines(task.get("logs") or [])
        limit = max(0, app.content_height - 3)
        recent = events[-limit:] if limit else []
        if recent:
            lines.append("")
            lines.append(colorize("最近步骤", "muted"))
            for entry in recent:
                lines.append(colorize("→ " + entry, "dim"))
        return lines

    def handle_key(self, key: str, app: Any) -> bool:
        if not self.state.get("started"):
            if key == "enter":
                active = find_active_auto_download_task()
                if active:
                    self.state["message"] = "已有自动下载正在运行，请先等待它完成。"
                    return True
                task_id = uuid.uuid4().hex
                DOWNLOAD_TASKS[task_id] = {
                    "status": "queued",
                    "message": "任务已提交",
                    "stage": "创建任务",
                    "progress": 3,
                    "logs": [],
                }
                worker = threading.Thread(target=run_auto_download_task, args=(task_id,), daemon=True)
                worker.start()
                self.state["task_id"] = task_id
                self.state["started"] = True
                self.state["finished"] = False
                self.state["message"] = ""
                return True
            return False

        task_id = self.state.get("task_id")
        task = DOWNLOAD_TASKS.get(task_id, {}) if task_id else {}
        status = task.get("status")
        if status in ("done", "error") and key in ("enter", "esc", "q"):
            self.state["started"] = False
            self.state["task_id"] = None
            self.state["finished"] = False
            self.state["message"] = ""
            self.switch_to_overview(app)
            return True
        return False

    def switch_to_overview(self, app: Any) -> None:
        for index, page in enumerate(app.pages):
            if page.key == "1":
                app.switch_page(index)
                break

    def footer(self, app: Any) -> str:
        if not self.state.get("started"):
            return "回车开始下载  ←→切页 q返回首页"
        task_id = self.state.get("task_id")
        status = (DOWNLOAD_TASKS.get(task_id, {}) or {}).get("status") if task_id else None
        if status in ("done", "error"):
            return "回车返回首页  Ctrl+C退出"
        return "下载中... 请勿关闭窗口  Ctrl+C退出"