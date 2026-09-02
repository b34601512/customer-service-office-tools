#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..login_dom import LoginFillResult


@dataclass(frozen=True)
class BrowserPageState:
    target_key: str
    target_name: str
    title: str
    url: str
    user_data_dir: Path


@dataclass(frozen=True)
class BrowserLoginProbe:
    page_state: BrowserPageState
    title_matched: bool
    fill_result: LoginFillResult


@dataclass
class _BrowserCommand:
    name: str
    args: tuple[Any, ...]
    kwargs: dict[str, Any]
    done: threading.Event
    result: Any = None
    error: BaseException | None = None


__all__ = ["BrowserPageState", "BrowserLoginProbe", "_BrowserCommand"]
