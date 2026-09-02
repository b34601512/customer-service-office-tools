#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AppMetadata:
    app_name: str
    version: str


APP_METADATA = AppMetadata(app_name="抖音直播评论员", version="v0.6")

__all__ = ["APP_METADATA", "AppMetadata"]
