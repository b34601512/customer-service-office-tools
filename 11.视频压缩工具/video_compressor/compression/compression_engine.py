from __future__ import annotations

import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from video_compressor.compression.bitrate_calculator import (
    build_compression_plan,
    calculate_target_total_bitrate,
    estimate_target_bytes,
    shrink_total_bitrate,
)
from video_compressor.compression.ffmpeg_runner import run_two_pass_encode
from video_compressor.compression.path_helper import build_output_path, ensure_output_dir
from video_compressor.media.media_probe import probe_media_info
from video_compressor.progress.progress_models import ProgressCallback, ProgressContext, emit_progress
from video_compressor.utils.action_logger import log_action


@dataclass(slots=True)
class CompressionResult:
    input_path: Path
    output_path: Path
    target_size_mb: float
    output_size_bytes: int
    duration_seconds: float
    attempts: int


def validate_input_file(input_path: Path) -> None:
    """提前校验输入路径，避免真正启动压缩后才发现路径不合法。"""
    if not input_path.exists():
        raise FileNotFoundError(f"输入文件不存在：{input_path}")
    if not input_path.is_file():
        raise ValueError(f"输入路径不是文件：{input_path}")


def compress_video_file(
    input_path: str | Path,
    target_size_mb: float,
    output_dir: str | Path,
    ffmpeg_path: str,
    file_index: int = 1,
    total_files: int = 1,
    progress_callback: ProgressCallback | None = None,
) -> CompressionResult:
    """按目标体积压缩单个视频，并在超标时自动重试收紧码率。"""
    source_path = Path(input_path).resolve()
    progress_context = ProgressContext(
        file_name=source_path.name,
        file_index=file_index,
        total_files=total_files,
        attempt_index=0,
    )

    emit_progress(progress_callback, progress_context, "准备任务", 0.0, "正在校验输入文件。")
    validate_input_file(source_path)

    output_root = ensure_output_dir(output_dir)
    target_output_path = build_output_path(source_path, output_root, target_size_mb)
    emit_progress(progress_callback, progress_context, "分析视频", 0.0, "正在读取视频时长和原始大小。")
    media_info = probe_media_info(source_path, ffmpeg_path)
    target_bytes = estimate_target_bytes(target_size_mb)
    total_bitrate_kbps = calculate_target_total_bitrate(media_info.duration_seconds, target_size_mb)

    log_action(
        "压缩主线:准备",
        "压缩引擎",
        "初始化任务",
        f"文件={source_path.name} 原始大小={media_info.size_bytes / 1024 / 1024:.2f}MB 目标大小={target_size_mb}MB",
    )

    with tempfile.TemporaryDirectory(prefix="video_compressor_") as temp_dir:
        temp_dir_path = Path(temp_dir)

        for attempt in range(1, 4):
            attempt_context = ProgressContext(
                file_name=source_path.name,
                file_index=file_index,
                total_files=total_files,
                attempt_index=attempt,
            )
            plan = build_compression_plan(total_bitrate_kbps)
            temp_output_path = temp_dir_path / f"attempt_{attempt}.mp4"
            passlog_prefix = temp_dir_path / f"pass_{attempt}"

            emit_progress(
                progress_callback,
                attempt_context,
                "准备压缩",
                0.0,
                f"正在准备第 {attempt} 次压缩参数。",
            )
            log_action(
                "压缩主线:执行",
                "压缩引擎",
                "启动两遍压缩",
                f"第{attempt}次尝试 文件={source_path.name}",
            )
            run_two_pass_encode(
                source_path,
                temp_output_path,
                ffmpeg_path,
                plan,
                passlog_prefix,
                media_info.duration_seconds,
                attempt_context,
                progress_callback,
            )

            output_size_bytes = temp_output_path.stat().st_size
            emit_progress(
                progress_callback,
                attempt_context,
                "校验结果",
                100.0,
                f"正在检查压缩结果，当前输出 {output_size_bytes / 1024 / 1024:.2f}MB。",
            )
            log_action(
                "压缩主线:校验",
                "压缩引擎",
                "检查输出大小",
                f"第{attempt}次尝试 输出={output_size_bytes / 1024 / 1024:.2f}MB 目标={target_size_mb}MB",
            )

            if output_size_bytes <= target_bytes:
                shutil.move(str(temp_output_path), str(target_output_path))
                emit_progress(
                    progress_callback,
                    attempt_context,
                    "保存结果",
                    100.0,
                    f"压缩完成，结果已保存到 {target_output_path.name}。",
                )
                log_action(
                    "压缩主线:完成",
                    "压缩引擎",
                    "保存最终文件",
                    f"输出文件={target_output_path}",
                )
                return CompressionResult(
                    input_path=source_path,
                    output_path=target_output_path,
                    target_size_mb=target_size_mb,
                    output_size_bytes=output_size_bytes,
                    duration_seconds=media_info.duration_seconds,
                    attempts=attempt,
                )

            if attempt == 3:
                raise RuntimeError(
                    f"压缩了 3 次仍然超过目标大小。"
                    f"目标={target_size_mb}MB，实际输出={output_size_bytes / 1024 / 1024:.2f}MB。"
                )

            emit_progress(
                progress_callback,
                attempt_context,
                "重新规划码率",
                0.0,
                f"当前结果仍超标，正在启动第 {attempt + 1} 次压缩。",
            )
            total_bitrate_kbps = shrink_total_bitrate(total_bitrate_kbps, target_bytes, output_size_bytes)


def compress_videos(
    input_paths: Iterable[str | Path],
    target_size_mb: float,
    output_dir: str | Path,
    ffmpeg_path: str,
    progress_callback: ProgressCallback | None = None,
) -> list[CompressionResult]:
    """按顺序处理多个视频，保持流程简单可控，便于日志追踪。"""
    results: list[CompressionResult] = []
    normalized_paths = list(input_paths)
    total_files = len(normalized_paths)

    if total_files == 0:
        return results

    for index, input_path in enumerate(normalized_paths, start=1):
        log_action("批处理主线:开始", "压缩引擎", "处理单个文件", f"序号={index} 文件={input_path}")
        result = compress_video_file(
            input_path,
            target_size_mb,
            output_dir,
            ffmpeg_path,
            file_index=index,
            total_files=total_files,
            progress_callback=progress_callback,
        )
        results.append(result)

    log_action("批处理主线:完成", "压缩引擎", "全部任务结束", f"成功数量={len(results)}")
    return results
