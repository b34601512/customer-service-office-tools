#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AppMetadata:
    app_name: str
    version: str

    @property
    def display_version(self) -> str:
        # 统一生成界面展示版本，避免不同位置手写 v 前缀。
        return f"v{self.version}"


APP_METADATA = AppMetadata(
    app_name="响应时间",
    version="0.16",
)


def build_window_title() -> str:
    # 统一生成窗口标题，避免窗口标题和页面信息栏版本不一致。
    return f"{APP_METADATA.app_name} {APP_METADATA.display_version} 后台"
