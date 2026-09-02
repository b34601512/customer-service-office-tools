#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ReleaseInfo:
    display_version: str
    package_dir_name: str


def read_pack_config(project_root: Path) -> dict[str, Any]:
    # 该函数集中读取打包配置，缺失时直接抛错避免打出未知版本包。
    config_path = Path(project_root) / "打包配置.json"
    if not config_path.exists():
        raise RuntimeError(f"缺少打包配置文件：{config_path}")
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise RuntimeError(f"读取打包配置失败：{config_path}（{type(exc).__name__}: {exc}）") from exc
    if not isinstance(raw, dict):
        raise RuntimeError("打包配置错误：根节点必须是对象")
    return raw


def normalize_display_version(value: Any) -> str:
    # 该函数统一对外版本文本，当前项目按 v0.01 这种展示格式发布。
    text = str(value or "").strip()
    if not text:
        raise RuntimeError("打包配置错误：displayVersion 不能为空")
    if not text.lower().startswith("v"):
        text = f"v{text}"
    if re.search(r'[<>:"/\\|?*\x00-\x1f]', text):
        raise RuntimeError(f"打包配置错误：displayVersion 含非法字符，当前值={text!r}")
    return text


def read_release_info(project_root: Path) -> ReleaseInfo:
    # 该函数把显示版本和分发目录名收口，避免 zip 名称和后台版本不一致。
    version = normalize_display_version(read_pack_config(project_root).get("displayVersion"))
    return ReleaseInfo(display_version=version, package_dir_name=f"refund-reminder-cs-{version}")


__all__ = ["ReleaseInfo", "normalize_display_version", "read_pack_config", "read_release_info"]
