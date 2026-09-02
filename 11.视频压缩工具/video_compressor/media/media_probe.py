from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from video_compressor.utils.action_logger import log_action
from video_compressor.utils.subprocess_window import get_hidden_process_kwargs

DURATION_PATTERN = re.compile(r"Duration:\s*(\d+):(\d+):([\d.]+)")


@dataclass(slots=True)
class MediaInfo:
    duration_seconds: float
    size_bytes: int


def probe_media_info(input_path: Path, ffmpeg_path: str) -> MediaInfo:
    """通过 ffmpeg 读取时长，为目标体积换算码率提供基础数据。"""
    log_action("探测主线:开始", "媒体探测", "读取媒体信息", f"文件={input_path}")

    result = subprocess.run(
        [ffmpeg_path, "-hide_banner", "-i", str(input_path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        check=False,
        **get_hidden_process_kwargs(),
    )

    duration_seconds = parse_duration_seconds(result.stderr)
    size_bytes = input_path.stat().st_size

    log_action(
        "探测主线:完成",
        "媒体探测",
        "媒体信息就绪",
        f"时长={duration_seconds:.2f}秒 原始大小={size_bytes / 1024 / 1024:.2f}MB",
    )

    return MediaInfo(duration_seconds=duration_seconds, size_bytes=size_bytes)


def parse_duration_seconds(stderr_text: str) -> float:
    """从 ffmpeg 的输出中提取 Duration 字段。"""
    match = DURATION_PATTERN.search(stderr_text)
    if not match:
        raise ValueError("无法从视频中识别时长信息，文件可能已损坏或格式不受支持。")

    hours = int(match.group(1))
    minutes = int(match.group(2))
    seconds = float(match.group(3))
    return hours * 3600 + minutes * 60 + seconds
