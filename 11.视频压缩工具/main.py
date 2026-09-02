from __future__ import annotations

import argparse
from pathlib import Path

from video_compressor.app_metadata import APP_NAME, APP_VERSION
from video_compressor.compression.compression_engine import compress_videos
from video_compressor.config.config_manager import AppConfig, load_config, save_config
from video_compressor.media.ffmpeg_provider import get_ffmpeg_executable
from video_compressor.ui.gui_app import launch_gui
from video_compressor.utils.action_logger import log_action


def build_parser() -> argparse.ArgumentParser:
    """构建命令行参数，让 GUI 和 CLI 共用同一套配置入口。"""
    parser = argparse.ArgumentParser(description=f"{APP_NAME} v{APP_VERSION}，把视频压缩到指定大小以下，默认目标为 25MB。")
    parser.add_argument("inputs", nargs="*", help="要压缩的视频路径，可一次传多个。")
    parser.add_argument("--target-size-mb", type=float, help="目标大小，单位 MB。")
    parser.add_argument("--output-dir", help="输出目录。")
    parser.add_argument("--gui", action="store_true", help="强制启动图形界面。")
    return parser


def run_cli(args: argparse.Namespace, config: AppConfig) -> None:
    """命令行模式直接触发压缩，方便批处理和自动化脚本复用。"""
    if not args.inputs:
        raise ValueError("命令行模式至少需要传入一个视频文件路径。")

    target_size_mb = args.target_size_mb if args.target_size_mb is not None else config.target_size_mb
    output_dir = Path(args.output_dir if args.output_dir else config.output_dir).resolve()

    save_config(AppConfig(target_size_mb=target_size_mb, output_dir=str(output_dir)))
    ffmpeg_path = get_ffmpeg_executable()

    log_action("启动主线:开始", "程序入口", "命令行压缩", f"文件数量={len(args.inputs)} 目标大小={target_size_mb}MB")
    results = compress_videos(args.inputs, target_size_mb, output_dir, ffmpeg_path)

    for result in results:
        print(
            f"压缩完成：{result.input_path.name} -> {result.output_path}，"
            f"输出大小={result.output_size_bytes / 1024 / 1024:.2f}MB，尝试次数={result.attempts}",
            flush=True,
        )

    log_action("启动主线:完成", "程序入口", "命令行压缩", "全部文件压缩完成")


def main() -> None:
    """根据输入参数决定启动 GUI 还是直接走命令行压缩。"""
    parser = build_parser()
    args = parser.parse_args()
    config = load_config()

    if args.gui or not args.inputs:
        log_action("启动主线:开始", "程序入口", "图形界面", "准备启动桌面程序")
        launch_gui(config)
        return

    run_cli(args, config)


if __name__ == "__main__":
    main()
