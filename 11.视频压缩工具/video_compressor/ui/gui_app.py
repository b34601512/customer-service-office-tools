from __future__ import annotations

import queue
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from video_compressor.app_metadata import APP_NAME, APP_VERSION, AUTHOR_NAME, AUTHOR_WECHAT, OFFICIAL_WEBSITE
from video_compressor.compression.compression_engine import compress_videos
from video_compressor.config.config_manager import AppConfig, save_config
from video_compressor.media.ffmpeg_provider import get_ffmpeg_executable
from video_compressor.progress.progress_models import ProgressUpdate
from video_compressor.utils.action_logger import log_action, register_log_listener, unregister_log_listener


class VideoCompressorApp:
    def __init__(self, root: tk.Tk, config: AppConfig) -> None:
        self.root = root
        self.config = config
        self.selected_files: list[str] = []
        self.ui_queue: queue.Queue[tuple[str, object]] = queue.Queue()
        self.log_listener = self._enqueue_log
        self.worker_thread: threading.Thread | None = None
        self.ffmpeg_path = get_ffmpeg_executable()

        register_log_listener(self.log_listener)
        self.root.title(f"{APP_NAME} v{APP_VERSION}")
        self.root.geometry("860x620")
        self.root.minsize(800, 560)
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        self.target_size_var = tk.StringVar(value=str(config.target_size_mb))
        self.output_dir_var = tk.StringVar(value=config.output_dir)
        self.status_var = tk.StringVar(value="请选择要压缩的视频文件。")
        self.progress_title_var = tk.StringVar(value="当前动作：等待开始")
        self.progress_detail_var = tk.StringVar(value="进度条会在压缩开始后实时更新。")
        self.file_count_var = tk.StringVar(value="当前未选择文件。")
        self.file_hint_var = tk.StringVar(value="这里只显示你已选择的文件；文件少时区域会自动收缩。")

        self.build_layout()
        self.root.after(100, self.flush_ui_queue)

    def build_layout(self) -> None:
        """构建界面结构，让文件选择、参数设置和日志展示彼此分层清晰。"""
        container = ttk.Frame(self.root, padding=16)
        container.pack(fill="both", expand=True)
        container.columnconfigure(0, weight=1)
        container.rowconfigure(7, weight=1)

        title_label = ttk.Label(container, text=APP_NAME, font=("Microsoft YaHei UI", 18, "bold"))
        title_label.grid(row=0, column=0, sticky="w")

        intro_label = ttk.Label(
            container,
            text="默认把视频压到 25MB 以下；你也可以改成别的目标大小。",
            font=("Microsoft YaHei UI", 10),
        )
        intro_label.grid(row=1, column=0, sticky="w", pady=(4, 12))

        info_frame = ttk.Frame(container)
        info_frame.grid(row=2, column=0, sticky="w", pady=(0, 12))

        info_label = ttk.Label(
            info_frame,
            text=f"版本：v{APP_VERSION}    作者：{AUTHOR_NAME}    微信：{AUTHOR_WECHAT}    话术精灵官网：",
            font=("Microsoft YaHei UI", 9),
        )
        info_label.grid(row=0, column=0, sticky="w")

        website_label = tk.Label(
            info_frame,
            text=OFFICIAL_WEBSITE,
            font=("Microsoft YaHei UI", 9, "underline"),
            fg="#0a66c2",
            cursor="hand2",
        )
        website_label.grid(row=0, column=1, sticky="w")
        website_label.bind("<Button-1>", self.open_official_website)

        control_frame = ttk.LabelFrame(container, text="参数设置", padding=12)
        control_frame.grid(row=3, column=0, sticky="ew")
        control_frame.columnconfigure(1, weight=1)

        ttk.Button(control_frame, text="选择视频", command=self.choose_files).grid(row=0, column=0, sticky="w")
        ttk.Label(control_frame, textvariable=self.file_count_var).grid(row=0, column=1, sticky="w", padx=(12, 0))

        ttk.Label(control_frame, text="目标大小（MB）").grid(row=1, column=0, sticky="w", pady=(12, 0))
        ttk.Entry(control_frame, textvariable=self.target_size_var, width=18).grid(row=1, column=1, sticky="w", pady=(12, 0))

        ttk.Label(control_frame, text="输出目录").grid(row=2, column=0, sticky="w", pady=(12, 0))
        output_entry = ttk.Entry(control_frame, textvariable=self.output_dir_var)
        output_entry.grid(row=2, column=1, sticky="ew", pady=(12, 0))
        ttk.Button(control_frame, text="选择目录", command=self.choose_output_dir).grid(row=2, column=2, padx=(8, 0), pady=(12, 0))

        action_frame = ttk.Frame(container, padding=(0, 12, 0, 12))
        action_frame.grid(row=4, column=0, sticky="ew")
        action_frame.columnconfigure(1, weight=1)

        self.start_button = ttk.Button(action_frame, text="开始压缩", command=self.start_compression)
        self.start_button.grid(row=0, column=0, sticky="w")
        ttk.Label(action_frame, textvariable=self.status_var).grid(row=0, column=1, sticky="w", padx=(12, 0))

        progress_frame = ttk.LabelFrame(container, text="当前进度", padding=12)
        progress_frame.grid(row=5, column=0, sticky="ew")
        progress_frame.columnconfigure(0, weight=1)

        ttk.Label(progress_frame, textvariable=self.progress_title_var).grid(row=0, column=0, sticky="w")
        self.progressbar = ttk.Progressbar(progress_frame, orient="horizontal", mode="determinate", maximum=100)
        self.progressbar.grid(row=1, column=0, sticky="ew", pady=(8, 6))
        ttk.Label(progress_frame, textvariable=self.progress_detail_var).grid(row=2, column=0, sticky="w")

        list_frame = ttk.LabelFrame(container, text="已选文件", padding=12)
        list_frame.grid(row=6, column=0, sticky="ew", pady=(12, 0))
        list_frame.columnconfigure(0, weight=1)

        ttk.Label(list_frame, textvariable=self.file_hint_var).grid(row=0, column=0, sticky="w", columnspan=2, pady=(0, 8))

        self.file_listbox = tk.Listbox(
            list_frame,
            height=2,
            font=("Microsoft YaHei UI", 10),
            activestyle="none",
            exportselection=False,
        )
        self.file_listbox.grid(row=1, column=0, sticky="nsew")
        file_scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.file_listbox.yview)
        file_scrollbar.grid(row=1, column=1, sticky="ns")
        file_horizontal_scrollbar = ttk.Scrollbar(list_frame, orient="horizontal", command=self.file_listbox.xview)
        file_horizontal_scrollbar.grid(row=2, column=0, sticky="ew", pady=(6, 0))
        self.file_listbox.configure(yscrollcommand=file_scrollbar.set, xscrollcommand=file_horizontal_scrollbar.set)

        log_frame = ttk.LabelFrame(container, text="执行日志", padding=12)
        log_frame.grid(row=7, column=0, sticky="nsew", pady=(12, 0))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)

        self.log_text = tk.Text(log_frame, wrap="word", height=14, font=("Consolas", 10), state="disabled")
        self.log_text.grid(row=0, column=0, sticky="nsew")
        log_scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        log_scrollbar.grid(row=0, column=1, sticky="ns")
        self.log_text.configure(yscrollcommand=log_scrollbar.set)

    def choose_files(self) -> None:
        """选择一个或多个视频文件，并把结果立即反馈到界面上。"""
        files = filedialog.askopenfilenames(
            title="选择要压缩的视频",
            filetypes=[("视频文件", "*.mp4 *.mov *.avi *.mkv *.flv *.wmv *.m4v"), ("所有文件", "*.*")],
        )
        if not files:
            return

        self.selected_files = list(files)
        self.file_listbox.delete(0, tk.END)
        for file_path in self.selected_files:
            self.file_listbox.insert(tk.END, file_path)

        self.file_listbox.configure(height=self.calculate_file_list_height(len(self.selected_files)))
        self.file_count_var.set(f"已选择 {len(self.selected_files)} 个文件。")
        self.file_hint_var.set("文件名过长时，可以左右拖动下面的滚动条查看完整路径。")
        self.status_var.set("文件已选择，可以开始压缩。")
        log_action("界面主线:反馈", "图形界面", "完成文件选择", f"文件数量={len(self.selected_files)}")

    def choose_output_dir(self) -> None:
        """选择输出目录，并让界面马上显示新的保存位置。"""
        directory = filedialog.askdirectory(title="选择输出目录")
        if not directory:
            return

        self.output_dir_var.set(str(Path(directory).resolve()))
        self.status_var.set("输出目录已更新。")
        log_action("界面主线:反馈", "图形界面", "完成目录选择", f"输出目录={directory}")

    def start_compression(self) -> None:
        """校验界面参数后启动后台线程，避免主界面在压缩期间卡死。"""
        if not self.selected_files:
            messagebox.showwarning("缺少文件", "请先选择至少一个视频文件。")
            return

        target_text = self.target_size_var.get().strip()
        if not target_text:
            messagebox.showwarning("缺少目标大小", "请输入目标大小。")
            return

        try:
            target_size_mb = float(target_text)
        except ValueError:
            messagebox.showwarning("目标大小无效", "目标大小必须是数字，例如 25 或 12.5。")
            return

        output_text = self.output_dir_var.get().strip()
        if not output_text:
            messagebox.showwarning("缺少输出目录", "请选择输出目录。")
            return

        output_dir = Path(output_text).resolve()

        save_config(AppConfig(target_size_mb=target_size_mb, output_dir=str(output_dir)))
        self.start_button.configure(state="disabled")
        self.status_var.set("正在压缩，请耐心等待。")
        self.progressbar.configure(value=0)
        self.progress_title_var.set("当前动作：正在准备压缩任务")
        self.progress_detail_var.set("正在校验参数并初始化压缩流程。")
        self.append_log_line("========== 开始新的压缩任务 ==========")

        self.worker_thread = threading.Thread(
            target=self.run_compression_worker,
            args=(list(self.selected_files), target_size_mb, output_dir),
            daemon=True,
        )
        self.worker_thread.start()

    def run_compression_worker(self, files: list[str], target_size_mb: float, output_dir: Path) -> None:
        """在后台线程执行压缩，让界面只负责展示状态和反馈。"""
        try:
            results = compress_videos(
                files,
                target_size_mb,
                output_dir,
                self.ffmpeg_path,
                progress_callback=self._enqueue_progress,
            )
        except Exception as exc:
            self.ui_queue.put(("error", str(exc)))
            raise

        summary = "\n".join(
            f"{result.input_path.name} -> {result.output_path.name}（{result.output_size_bytes / 1024 / 1024:.2f}MB）"
            for result in results
        )
        self.ui_queue.put(("success", summary))

    def flush_ui_queue(self) -> None:
        """把后台线程产出的日志和结果安全地同步到 Tk 主线程。"""
        while True:
            try:
                event_type, payload = self.ui_queue.get_nowait()
            except queue.Empty:
                break

            if event_type == "log":
                self.append_log_line(str(payload))
                continue

            if event_type == "progress":
                self.apply_progress_update(payload)
                continue

            if event_type == "error":
                self.start_button.configure(state="normal")
                self.status_var.set("压缩失败，请查看日志。")
                self.progress_title_var.set("当前动作：压缩失败")
                self.progress_detail_var.set(str(payload))
                messagebox.showerror("压缩失败", str(payload))
                continue

            if event_type == "success":
                self.start_button.configure(state="normal")
                self.status_var.set("压缩完成。")
                self.progressbar.configure(value=100)
                self.progress_title_var.set("当前动作：全部文件压缩完成")
                self.progress_detail_var.set("所有任务都已完成，可以查看输出目录。")
                messagebox.showinfo("压缩完成", str(payload))

        self.root.after(100, self.flush_ui_queue)

    def append_log_line(self, text: str) -> None:
        """把一行日志追加到文本框底部，保持用户能即时看到最新状态。"""
        self.log_text.configure(state="normal")
        self.log_text.insert(tk.END, text + "\n")
        self.log_text.see(tk.END)
        self.log_text.configure(state="disabled")

    def calculate_file_list_height(self, file_count: int) -> int:
        """按文件数量动态决定列表高度，避免只有一个文件时出现大块空白。"""
        return min(max(file_count, 1), 4)

    def open_official_website(self, event: tk.Event | None = None) -> None:
        """点击官网文字后，用系统默认浏览器打开官方网站。"""
        website_url = f"https://{OFFICIAL_WEBSITE}"
        log_action("界面主线:跳转", "图形界面", "打开官网", f"网址={website_url}")
        try:
            opened = webbrowser.open_new_tab(website_url)
        except webbrowser.Error as exc:
            # 解决窗口态exe没有控制台、失败原因必须可见反馈给用户的问题。
            messagebox.showerror("打开官网失败", f"打开官网失败：{website_url}\n{exc}")
            return
        if not opened:
            messagebox.showerror("打开官网失败", f"系统没有成功打开浏览器，请手动访问：{website_url}")

    def _enqueue_log(self, text: str) -> None:
        """把日志转交给队列，避免工作线程直接操作 Tk 控件。"""
        self.ui_queue.put(("log", text))

    def _enqueue_progress(self, update: ProgressUpdate) -> None:
        """把底层进度事件投递给主线程，避免跨线程直接改界面。"""
        self.ui_queue.put(("progress", update))

    def apply_progress_update(self, update: ProgressUpdate) -> None:
        """把进度事件渲染成界面上的进度条和动作说明。"""
        self.progressbar.configure(value=update.phase_percent)
        self.status_var.set(f"正在处理第 {update.file_index} / {update.total_files} 个文件。")
        phase_text = update.phase_name
        if update.attempt_index > 0:
            phase_text = f"第 {update.attempt_index} 次尝试 - {update.phase_name}"
        self.progress_title_var.set(
            f"当前动作：第 {update.file_index} / {update.total_files} 个文件《{update.file_name}》"
            f" {phase_text} {update.phase_percent:.1f}%"
        )
        self.progress_detail_var.set(update.detail_text)

    def on_close(self) -> None:
        """关闭窗口前先解除日志监听，避免残留回调继续写界面。"""
        unregister_log_listener(self.log_listener)
        self.root.destroy()


def launch_gui(config: AppConfig) -> None:
    """启动 Tk 图形界面，为普通用户提供更直接的操作入口。"""
    root = tk.Tk()
    VideoCompressorApp(root, config)
    root.mainloop()
