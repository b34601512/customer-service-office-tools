# 该文件用于定义 ERP 页面控制器共享数据结构。
from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..order_detector import DetectionResult, ProblemOrder

ProblemOrderCallback = Callable[[ProblemOrder], None]


@dataclass(frozen=True)
class OrderPageDiagnosis:
    ready: bool
    matched_count: int
    matched_landmarks: tuple[str, ...]
    missing_landmarks: tuple[str, ...]
    has_order_keyword: bool
    required_texts_matched: bool
    text_sample: str
    login_wait_page: bool = False
    frame_count: int = 1
    frame_summaries: tuple[str, ...] = ()


@dataclass(frozen=True)
class BrowserPageState:
    title: str
    url: str
    user_data_dir: Path


@dataclass(frozen=True)
class ScanSummary:
    page_state: BrowserPageState
    detection: DetectionResult


@dataclass
class BrowserCommand:
    name: str
    args: tuple[Any, ...]
    done: threading.Event
    result: Any = None
    error: BaseException | None = None


__all__ = ["BrowserCommand", "BrowserPageState", "OrderPageDiagnosis", "ProblemOrderCallback", "ScanSummary"]
