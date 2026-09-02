from __future__ import annotations

from video_compressor.utils.action_logger import log_action


def get_ffmpeg_executable() -> str:
    """优先使用内置 ffmpeg，避免把系统环境变量当成前置依赖。"""
    try:
        import imageio_ffmpeg
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError("缺少 imageio-ffmpeg 依赖，请先执行 `python -m pip install -r requirements.txt`。") from exc

    ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    log_action("依赖主线:完成", "FFmpeg提供器", "定位可执行文件", f"ffmpeg={ffmpeg_path}")
    return ffmpeg_path
