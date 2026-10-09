#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AppMetadata:
    app_name: str
    version: str
    author_name: str
    author_wechat: str
    official_website: str
    official_website_url: str


def read_display_version(default: str = "v0.01") -> str:
    # 自 2026-09-16 起不再打包分发，版本号只保留一个常量默认值（原来读 打包配置.json）。
    return default


APP_METADATA = AppMetadata(
    app_name="退款自动提醒",
    version=read_display_version(),
    author_name="黎路遥",
    author_wechat="luyao2089",
    official_website="luyao2089.cc",
    official_website_url="https://luyao2089.cc",
)

__all__ = ["APP_METADATA", "AppMetadata", "read_display_version"]
