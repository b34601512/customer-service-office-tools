from __future__ import annotations

from dataclasses import dataclass

from video_compressor.utils.action_logger import log_action


@dataclass(slots=True)
class CompressionPlan:
    total_bitrate_kbps: int
    audio_bitrate_kbps: int
    video_bitrate_kbps: int


def estimate_target_bytes(target_size_mb: float) -> int:
    """把目标 MB 转成字节数，后续统一用字节做硬校验。"""
    if target_size_mb <= 0:
        raise ValueError("目标大小必须大于 0MB。")
    return int(target_size_mb * 1024 * 1024)


def calculate_target_total_bitrate(duration_seconds: float, target_size_mb: float, safety_ratio: float = 0.96) -> int:
    """按视频时长反推总码率，并预留一点安全边界避免超出目标体积。"""
    if duration_seconds <= 0:
        raise ValueError("视频时长必须大于 0 秒，无法计算目标码率。")

    target_bytes = estimate_target_bytes(target_size_mb)
    total_bits = target_bytes * 8 * safety_ratio
    total_bitrate_kbps = int(total_bits / duration_seconds / 1000)

    log_action(
        "规划主线:计算",
        "码率规划",
        "换算总码率",
        f"时长={duration_seconds:.2f}秒 目标大小={target_size_mb}MB 总码率={total_bitrate_kbps}k",
    )

    return total_bitrate_kbps


def build_compression_plan(total_bitrate_kbps: int) -> CompressionPlan:
    """根据总码率切分音视频码率，优先保证视频侧仍有可用空间。"""
    if total_bitrate_kbps < 32:
        raise ValueError("目标体积过小或视频时长过长，无法生成可用的压缩方案。")

    recommended_audio = choose_audio_bitrate(total_bitrate_kbps)
    audio_bitrate_kbps = min(recommended_audio, max(8, total_bitrate_kbps // 3))
    video_bitrate_kbps = total_bitrate_kbps - audio_bitrate_kbps - 8

    if video_bitrate_kbps < 16:
        audio_bitrate_kbps = max(8, total_bitrate_kbps - 24)
        video_bitrate_kbps = total_bitrate_kbps - audio_bitrate_kbps - 8

    if video_bitrate_kbps < 16:
        raise ValueError("目标体积太小，已经没有足够的视频码率可用。")

    plan = CompressionPlan(
        total_bitrate_kbps=total_bitrate_kbps,
        audio_bitrate_kbps=audio_bitrate_kbps,
        video_bitrate_kbps=video_bitrate_kbps,
    )

    log_action(
        "规划主线:完成",
        "码率规划",
        "生成压缩方案",
        f"总码率={plan.total_bitrate_kbps}k 视频={plan.video_bitrate_kbps}k 音频={plan.audio_bitrate_kbps}k",
    )

    return plan


def choose_audio_bitrate(total_bitrate_kbps: int) -> int:
    """按总码率给音频留出合理预算，避免视频码率被音频挤占。"""
    if total_bitrate_kbps <= 96:
        return 16
    if total_bitrate_kbps <= 160:
        return 24
    if total_bitrate_kbps <= 256:
        return 32
    if total_bitrate_kbps <= 384:
        return 48
    if total_bitrate_kbps <= 640:
        return 64
    return 96


def shrink_total_bitrate(current_total_kbps: int, target_bytes: int, actual_bytes: int) -> int:
    """当输出仍然超标时，按实际超标比例收紧下一轮总码率。"""
    if actual_bytes <= 0:
        raise ValueError("实际输出大小必须大于 0 字节。")

    ratio = target_bytes / actual_bytes
    adjusted_total = max(32, int(current_total_kbps * ratio * 0.97))

    log_action(
        "规划主线:重算",
        "码率规划",
        "收紧下一轮码率",
        f"当前总码率={current_total_kbps}k 新总码率={adjusted_total}k",
    )

    return adjusted_total
