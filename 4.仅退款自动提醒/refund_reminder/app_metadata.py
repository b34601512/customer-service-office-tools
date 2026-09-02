#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppMetadata:
    app_name: str
    version: str
    author_name: str
    author_wechat: str
    official_website: str
    official_website_url: str


def read_display_version(default: str = "v0.01") -> str:
    # 该函数让后台版本和打包配置共用同一个来源，避免分发包名称与页面版本不一致。
    config_path = Path(__file__).resolve().parents[1] / "打包配置.json"
    if not config_path.exists():
        return default
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise RuntimeError(f"读取打包版本失败：{config_path}（{type(exc).__name__}: {exc}）") from exc
    version = str(raw.get("displayVersion") or default).strip()
    if not version:
        return default
    return version if version.lower().startswith("v") else f"v{version}"


APP_METADATA = AppMetadata(
    app_name="退款自动提醒",
    version=read_display_version(),
    author_name="黎路遥",
    author_wechat="luyao2089",
    official_website="luyao2089.cc",
    official_website_url="https://luyao2089.cc",
)

__all__ = ["APP_METADATA", "AppMetadata", "read_display_version"]
