from __future__ import annotations

import os
import subprocess
from pathlib import Path

from video_compressor.compression.bitrate_calculator import CompressionPlan
from video_compressor.progress.progress_models import ProgressContext, emit_progress
from video_compressor.utils.action_logger import log_action
from video_compressor.utils.subprocess_window import get_hidden_process_kwargs


def run_two_pass_encode(
    input_path: Path,
    output_path: Path,
    ffmpeg_path: str,
    plan: CompressionPlan,
    passlog_prefix: Path,
    duration_seconds: float,
    progress_context: ProgressContext,
    progress_callback=None,
) -> None:
    """使用两遍码率控制压缩视频，让结果更稳定贴近目标体积。"""
    null_target = "NUL" if os.name == "nt" else "/dev/null"
    audio_channels = "1" if plan.audio_bitrate_kbps <= 32 else "2"

    pass1_command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
        str(input_path),
        "-map",
        "0:v:0",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        f"{plan.video_bitrate_kbps}k",
        "-maxrate",
        f"{plan.video_bitrate_kbps}k",
        "-bufsize",
        f"{plan.video_bitrate_kbps * 2}k",
        "-pass",
        "1",
        "-passlogfile",
        str(passlog_prefix),
        "-an",
        "-f",
        "mp4",
        null_target,
    ]

    pass2_command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
        str(input_path),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        f"{plan.video_bitrate_kbps}k",
        "-maxrate",
        f"{plan.video_bitrate_kbps}k",
        "-bufsize",
        f"{plan.video_bitrate_kbps * 2}k",
        "-pass",
        "2",
        "-passlogfile",
        str(passlog_prefix),
        "-c:a",
        "aac",
        "-b:a",
        f"{plan.audio_bitrate_kbps}k",
        "-ac",
        audio_channels,
        "-movflags",
        "+faststart",
        str(output_path),
    ]

    run_ffmpeg_command(
        pass1_command,
        "第一遍压缩",
        duration_seconds,
        progress_context,
        progress_callback,
    )
    run_ffmpeg_command(
        pass2_command,
        "第二遍压缩",
        duration_seconds,
        progress_context,
        progress_callback,
    )


def run_ffmpeg_command(
    command: list[str],
    stage_name: str,
    duration_seconds: float,
    progress_context: ProgressContext,
    progress_callback=None,
) -> None:
    """执行 ffmpeg 命令并把真实进度持续上报给上层界面。"""
    log_action("执行主线:开始", "FFmpeg执行器", stage_name, "命令已启动")

    emit_progress(
        progress_callback,
        progress_context,
        stage_name,
        0.0,
        f"正在启动{stage_name}。",
    )

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="ignore",
        bufsize=1,
        **get_hidden_process_kwargs(),
    )

    if process.stdout is None or process.stderr is None:
        raise RuntimeError(f"{stage_name}启动失败，无法读取 FFmpeg 的输出流。")

    progress_fields: dict[str, str] = {}

    for raw_line in process.stdout:
        line = raw_line.strip()
        if not line or "=" not in line:
            continue

        key, value = line.split("=", 1)
        progress_fields[key] = value

        if key != "progress":
            continue

        phase_percent = calculate_phase_percent(progress_fields, duration_seconds)
        detail_text = build_progress_detail(progress_fields, duration_seconds)
        emit_progress(progress_callback, progress_context, stage_name, phase_percent, detail_text)
        progress_fields = {}

    stderr_text = process.stderr.read()
    return_code = process.wait()

    if return_code != 0:
        stderr_tail = "\n".join(stderr_text.strip().splitlines()[-20:])
        raise RuntimeError(f"{stage_name}失败，FFmpeg 返回码={return_code}\n{stderr_tail}")

    emit_progress(progress_callback, progress_context, stage_name, 100.0, f"{stage_name}完成。")
    log_action("执行主线:完成", "FFmpeg执行器", stage_name, "命令执行成功")


def calculate_phase_percent(progress_fields: dict[str, str], duration_seconds: float) -> float:
    """把 ffmpeg 的当前处理时长换算成当前动作的真实百分比。"""
    if duration_seconds <= 0:
        return 0.0

    processed_seconds = parse_processed_seconds(progress_fields)
    if processed_seconds is None:
        return 0.0

    return min(100.0, processed_seconds / duration_seconds * 100)


def build_progress_detail(progress_fields: dict[str, str], duration_seconds: float) -> str:
    """把 ffmpeg 原始进度字段整理成更适合用户阅读的中文说明。"""
    processed_seconds = parse_processed_seconds(progress_fields)
    speed_text = progress_fields.get("speed", "").strip()

    if processed_seconds is None:
        return "正在读取编码进度。"

    detail_text = f"已处理 {format_seconds(processed_seconds)} / {format_seconds(duration_seconds)}"
    if speed_text and speed_text != "N/A":
        detail_text = f"{detail_text}，当前速度 {speed_text}"

    return detail_text


def parse_processed_seconds(progress_fields: dict[str, str]) -> float | None:
    """从 ffmpeg 进度字段中提取已经处理到的时间点。"""
    microseconds_text = progress_fields.get("out_time_ms") or progress_fields.get("out_time_us")
    if microseconds_text and microseconds_text != "N/A":
        try:
            return float(microseconds_text) / 1_000_000
        except ValueError:
            return None

    out_time_text = progress_fields.get("out_time", "")
    if out_time_text and out_time_text != "N/A":
        try:
            return parse_timecode_seconds(out_time_text)
        except ValueError:
            return None

    return None


def parse_timecode_seconds(timecode_text: str) -> float:
    """把 00:01:23.45 这样的时间字符串转换成秒数。"""
    hours_text, minutes_text, seconds_text = timecode_text.split(":")
    return int(hours_text) * 3600 + int(minutes_text) * 60 + float(seconds_text)


def format_seconds(total_seconds: float) -> str:
    """把秒数格式化成更适合在界面里展示的时间文本。"""
    safe_seconds = max(0.0, total_seconds)
    hours = int(safe_seconds // 3600)
    minutes = int((safe_seconds % 3600) // 60)
    seconds = safe_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:05.2f}"
