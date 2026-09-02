from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(slots=True)
class ProgressContext:
    file_name: str
    file_index: int
    total_files: int
    attempt_index: int


@dataclass(slots=True)
class ProgressUpdate:
    file_name: str
    file_index: int
    total_files: int
    attempt_index: int
    phase_name: str
    phase_percent: float
    detail_text: str


ProgressCallback = Callable[[ProgressUpdate], None]


def emit_progress(
    progress_callback: ProgressCallback | None,
    context: ProgressContext,
    phase_name: str,
    phase_percent: float,
    detail_text: str,
) -> None:
    """把统一结构的进度事件发给上层，避免界面直接依赖底层细节。"""
    if progress_callback is None:
        return

    normalized_percent = max(0.0, min(100.0, phase_percent))
    progress_callback(
        ProgressUpdate(
            file_name=context.file_name,
            file_index=context.file_index,
            total_files=context.total_files,
            attempt_index=context.attempt_index,
            phase_name=phase_name,
            phase_percent=normalized_percent,
            detail_text=detail_text,
        )
    )
