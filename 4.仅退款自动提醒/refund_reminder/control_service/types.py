# 该文件用于定义控制面板状态卡等共享数据结构。
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Indicator:
    title: str
    state: str
    detail: str


@dataclass(frozen=True)
class WorkflowStep:
    key: str
    title: str
    state: str
    detail: str
    updated_at: float


__all__ = ["Indicator", "WorkflowStep"]
