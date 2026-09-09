from __future__ import annotations

import math
import queue
import threading
import webbrowser
from pathlib import Path
from typing import Sequence

from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.widgets import Button, Footer, Header, Input, Label, ProgressBar, RichLog, Static, TextArea

from video_compressor.app_metadata import APP_NAME, APP_VERSION, AUTHOR_NAME, AUTHOR_WECHAT, OFFICIAL_WEBSITE
from video_compressor.compression.compression_engine import compress_videos
from video_compressor.config.config_manager import AppConfig, save_config
from video_compressor.media.ffmpeg_provider import get_ffmpeg_executable
from video_compressor.progress.progress_models import ProgressUpdate
from video_compressor.utils.action_logger import log_action, register_log_listener, unregister_log_listener


class VideoCompressorTui(App[None]):
    """视频压缩工具的终端界面。

    TUI 只负责采集参数、调度后台线程和渲染事件，压缩规则仍由压缩引擎统一提供。
    """

    TITLE = f"{APP_NAME} v{APP_VERSION}"
    SUB_TITLE = "终端界面"

    CSS = """
    Screen {
        background: $surface;
    }

    #body {
        height: 1fr;
        padding: 0 1;
    }

    #settings, #monitor {
        height: 1fr;
        padding: 1 2;
        border: round $primary;
    }

    #settings {
        width: 42%;
        min-width: 38;
        margin-right: 1;
    }

    #monitor {
        width: 58%;
    }

    .section-title {
        text-style: bold;
        color: $accent;
        margin-bottom: 1;
    }

    .field-label {
        margin-top: 1;
        margin-bottom: 0;
    }

    #input_paths {
        height: 4;
        margin-bottom: 0;
    }

    #target_size, #output_dir {
        margin-bottom: 0;
    }

    #actions {
        height: auto;
        margin-top: 0;
    }

    #actions Button {
        margin-right: 1;
    }

    #status {
        height: auto;
        margin-bottom: 1;
    }

    #progress_detail {
        height: auto;
        margin-top: 1;
        margin-bottom: 1;
    }

    #logs {
        height: 1fr;
        border: round $secondary;
        background: $panel;
    }

    #metadata {
        height: auto;
        color: $text-muted;
        margin-top: 1;
    }
    """

    BINDINGS = [
        ("ctrl+s", "start_compression", "开始压缩"),
        ("ctrl+l", "clear_paths", "清空路径"),
        ("ctrl+w", "open_website", "打开官网"),
        ("ctrl+q", "quit_app", "退出"),
    ]

    def __init__(
        self,
        config: AppConfig,
        initial_inputs: Sequence[str] | None = None,
        initial_target_size_mb: float | None = None,
        initial_output_dir: str | None = None,
    ) -> None:
        super().__init__()
        self.config = config
        self.initial_inputs = list(initial_inputs or [])
        self.initial_target_size_mb = initial_target_size_mb
        self.initial_output_dir = initial_output_dir
        self.ui_queue: queue.Queue[tuple[str, object]] = queue.Queue()
        self.worker_thread: threading.Thread | None = None
        self.ffmpeg_path: str | None = None
        self.log_listener = self._enqueue_log
        self._log_listener_registered = False

    def compose(self) -> ComposeResult:
        input_text = "\n".join(self.initial_inputs)
        target_size_text = str(
            self.initial_target_size_mb
            if self.initial_target_size_mb is not None
            else self.config.target_size_mb
        )
        output_dir_text = self.initial_output_dir or self.config.output_dir

        yield Header(show_clock=True)
        with Horizontal(id="body"):
            with VerticalScroll(id="settings"):
                yield Label("压缩设置", classes="section-title")
                yield Label("输入视频路径（每行一个，可粘贴多个路径）", classes="field-label")
                yield TextArea(
                    input_text,
                    id="input_paths",
                    placeholder="例如：\nD:\\视频\\示例1.mp4\nD:\\视频\\示例2.mov",
                )
                yield Label("目标大小（MB）", classes="field-label")
                yield Input(target_size_text, id="target_size", placeholder="例如：25")
                yield Label("输出目录", classes="field-label")
                yield Input(output_dir_text, id="output_dir", placeholder="输出目录路径")
                with Horizontal(id="actions"):
                    yield Button("开始压缩", id="start", variant="success")
                    yield Button("清空路径", id="clear")
                yield Static(
                    f"版本 v{APP_VERSION} · 作者 {AUTHOR_NAME} · 微信 {AUTHOR_WECHAT}\n"
                    f"官网 {OFFICIAL_WEBSITE}（按 W 打开）",
                    id="metadata",
                )

            with Vertical(id="monitor"):
                yield Label("当前任务", classes="section-title")
                yield Static("等待开始。", id="status")
                yield ProgressBar(total=100, show_eta=False, id="progress")
                yield Static("进度会在压缩开始后实时更新。", id="progress_detail")
                yield Label("执行日志", classes="section-title")
                yield RichLog(id="logs", markup=False, wrap=True, highlight=False)

        yield Footer()

    def on_mount(self) -> None:
        """在界面挂载后注册日志监听，并定时处理后台线程事件。"""
        register_log_listener(self.log_listener)
        self._log_listener_registered = True
        self.set_interval(0.1, self._drain_ui_queue)
        log_action("界面主线:启动", "终端界面", "准备就绪", "等待用户输入压缩参数")

    def on_unmount(self) -> None:
        """退出界面时解除日志监听，避免后台回调继续写入已销毁的界面。"""
        if self._log_listener_registered:
            unregister_log_listener(self.log_listener)
            self._log_listener_registered = False

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """把按钮事件统一转成界面动作。"""
        if event.button.id == "start":
            self.start_compression()
        elif event.button.id == "clear":
            self.clear_paths()

    def action_start_compression(self) -> None:
        """响应 Ctrl+S。"""
        self.start_compression()

    def action_clear_paths(self) -> None:
        """响应 Ctrl+L。"""
        self.clear_paths()

    def action_open_website(self) -> None:
        """用系统默认浏览器打开官方网站。"""
        website_url = f"https://{OFFICIAL_WEBSITE}"
        log_action("界面主线:跳转", "终端界面", "打开官网", f"网址={website_url}")
        try:
            opened = webbrowser.open_new_tab(website_url)
        except webbrowser.Error as exc:
            self._set_status(f"打开官网失败：{exc}")
            return

        self._set_status("已请求系统打开官网。" if opened else f"请手动访问：{website_url}")

    def action_quit_app(self) -> None:
        """任务运行时禁止退出，避免留下未完成的临时压缩任务。"""
        if self.worker_thread is not None and self.worker_thread.is_alive():
            self._set_status("压缩正在进行，任务完成后才能退出。")
            return
        self.exit()

    def clear_paths(self) -> None:
        """清空输入路径，让用户可以重新粘贴任务列表。"""
        if self._is_busy():
            self._set_status("压缩进行中，暂不能修改输入路径。")
            return
        self.query_one("#input_paths", TextArea).text = ""
        self._set_status("已清空输入路径。")

    def start_compression(self) -> None:
        """校验参数后启动后台压缩线程，保持 TUI 能继续响应。"""
        if self._is_busy():
            self._set_status("已有压缩任务正在进行。")
            return

        input_paths = self.parse_input_paths(self.query_one("#input_paths", TextArea).text)
        if not input_paths:
            self._set_status("请先输入至少一个视频路径。")
            return

        target_text = self.query_one("#target_size", Input).value.strip()
        try:
            target_size_mb = float(target_text)
        except ValueError:
            self._set_status("目标大小必须是数字，例如 25 或 12.5。")
            return

        if not math.isfinite(target_size_mb) or target_size_mb <= 0:
            self._set_status("目标大小必须大于 0MB。")
            return

        output_text = self.query_one("#output_dir", Input).value.strip()
        if not output_text:
            self._set_status("请先输入输出目录。")
            return

        output_dir = Path(output_text).expanduser().resolve()
        try:
            save_config(AppConfig(target_size_mb=target_size_mb, output_dir=str(output_dir)))
        except OSError as exc:
            self._set_status(f"保存配置失败：{exc}")
            return

        self._set_busy(True)
        self.query_one(ProgressBar).update(progress=0)
        self.query_one("#progress_detail", Static).update("正在校验参数并初始化压缩流程。")
        self._set_status(f"准备处理 {len(input_paths)} 个文件。")
        self._write_log("========== 开始新的压缩任务 ==========")

        self.worker_thread = threading.Thread(
            target=self._run_compression_worker,
            args=(input_paths, target_size_mb, output_dir),
            name="video-compressor-worker",
            daemon=True,
        )
        self.worker_thread.start()

    def _run_compression_worker(
        self,
        input_paths: list[str],
        target_size_mb: float,
        output_dir: Path,
    ) -> None:
        """在线程中执行压缩，所有界面更新都通过队列返回主线程。"""
        try:
            if self.ffmpeg_path is None:
                self.ffmpeg_path = get_ffmpeg_executable()
            results = compress_videos(
                input_paths,
                target_size_mb,
                output_dir,
                self.ffmpeg_path,
                progress_callback=self._enqueue_progress,
            )
        except Exception as exc:
            self.ui_queue.put(("error", str(exc)))
            return

        summary = "\n".join(
            f"{result.input_path.name} -> {result.output_path.name}"
            f"（{result.output_size_bytes / 1024 / 1024:.2f}MB）"
            for result in results
        )
        self.ui_queue.put(("success", summary))

    def _drain_ui_queue(self) -> None:
        """在 Textual 主线程中批量处理日志、进度和结果事件。"""
        while True:
            try:
                event_type, payload = self.ui_queue.get_nowait()
            except queue.Empty:
                return

            if event_type == "log":
                self._write_log(str(payload))
            elif event_type == "progress":
                self._apply_progress_update(payload)
            elif event_type == "error":
                self._handle_error(str(payload))
            elif event_type == "success":
                self._handle_success(str(payload))

    def _apply_progress_update(self, update: object) -> None:
        """把统一进度事件渲染到进度条和状态文字。"""
        if not isinstance(update, ProgressUpdate):
            return

        self.query_one(ProgressBar).update(progress=update.phase_percent)
        phase_text = update.phase_name
        if update.attempt_index > 0:
            phase_text = f"第 {update.attempt_index} 次尝试 - {phase_text}"
        self._set_status(
            f"第 {update.file_index}/{update.total_files} 个文件：{update.file_name} · {phase_text}"
            f" · {update.phase_percent:.1f}%"
        )
        self.query_one("#progress_detail", Static).update(update.detail_text)

    def _handle_error(self, message: str) -> None:
        self._set_busy(False)
        self._set_status("压缩失败，请查看日志。")
        self.query_one("#progress_detail", Static).update(message)
        self._write_log(f"[错误] {message}")

    def _handle_success(self, summary: str) -> None:
        self._set_busy(False)
        self.query_one(ProgressBar).update(progress=100)
        self._set_status("全部文件压缩完成。")
        self.query_one("#progress_detail", Static).update("结果已保存到输出目录。")
        if summary:
            for line in summary.splitlines():
                self._write_log(line)

    def _set_busy(self, busy: bool) -> None:
        """锁定或恢复任务输入控件。"""
        for selector, widget_type in (
            ("#input_paths", TextArea),
            ("#target_size", Input),
            ("#output_dir", Input),
            ("#start", Button),
            ("#clear", Button),
        ):
            self.query_one(selector, widget_type).disabled = busy

    def _is_busy(self) -> bool:
        return self.worker_thread is not None and self.worker_thread.is_alive()

    def _set_status(self, text: str) -> None:
        self.query_one("#status", Static).update(text)

    def _write_log(self, text: str) -> None:
        self.query_one("#logs", RichLog).write(text)

    def _enqueue_log(self, text: str) -> None:
        """把日志投递到队列，避免后台线程直接操作 Textual 控件。"""
        self.ui_queue.put(("log", text))

    def _enqueue_progress(self, update: ProgressUpdate) -> None:
        """把进度投递到队列，避免后台线程直接操作 Textual 控件。"""
        self.ui_queue.put(("progress", update))

    @staticmethod
    def parse_input_paths(text: str) -> list[str]:
        """解析文本框中的路径，每行一个并去除资源管理器复制时的引号。"""
        paths: list[str] = []
        for raw_line in text.splitlines():
            path_text = raw_line.strip()
            if not path_text:
                continue
            if len(path_text) >= 2 and path_text[0] == path_text[-1] == '"':
                path_text = path_text[1:-1].strip()
            if path_text:
                paths.append(path_text)
        return paths


def launch_tui(
    config: AppConfig,
    initial_inputs: Sequence[str] | None = None,
    initial_target_size_mb: float | None = None,
    initial_output_dir: str | None = None,
) -> None:
    """启动终端界面。"""
    VideoCompressorTui(
        config,
        initial_inputs=initial_inputs,
        initial_target_size_mb=initial_target_size_mb,
        initial_output_dir=initial_output_dir,
    ).run()
