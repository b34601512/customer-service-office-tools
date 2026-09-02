from __future__ import annotations

from pathlib import Path

from video_compressor.utils.action_logger import log_action


def ensure_output_dir(output_dir: str | Path) -> Path:
    """确保输出目录存在，避免压缩完成后因为目录不存在而写入失败。"""
    resolved_dir = Path(output_dir).resolve()
    resolved_dir.mkdir(parents=True, exist_ok=True)
    log_action("路径主线:准备", "路径工具", "确认输出目录", f"输出目录={resolved_dir}")
    return resolved_dir


def build_output_path(input_path: Path, output_dir: Path, target_size_mb: float) -> Path:
    """生成不覆盖原文件的输出路径，避免把已有结果静默覆盖掉。"""
    size_label = format_size_label(target_size_mb)
    candidate = output_dir / f"{input_path.stem}_{size_label}.mp4"
    counter = 2

    while candidate.exists():
        candidate = output_dir / f"{input_path.stem}_{size_label}_{counter}.mp4"
        counter += 1

    log_action("路径主线:完成", "路径工具", "生成输出路径", f"输出文件={candidate}")
    return candidate


def format_size_label(target_size_mb: float) -> str:
    """把目标体积转成适合文件名的标签，避免文件名出现非法字符。"""
    raw_text = f"{target_size_mb:.2f}".rstrip("0").rstrip(".")
    return f"{raw_text.replace('.', '_')}mb"
