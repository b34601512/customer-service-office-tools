#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from pathlib import Path


def collect_files(path: Path) -> list[Path]:
    # 该函数用于递归收集目录文件，安全校验只看分发目录。
    root = Path(path)
    if not root.exists():
        return []
    return [item for item in root.rglob("*") if item.is_file()]


def ensure_runtime_has_no_login_state(package_dir: Path) -> None:
    # 该函数阻止浏览器登录态、历史处理记录和日志进入客服分发包。
    runtime_dir = Path(package_dir) / "runtime"
    blocked_dirs = [
        runtime_dir / "browser_profiles",
        Path(package_dir) / "logs",
    ]
    leaked_files = [file for directory in blocked_dirs for file in collect_files(directory)]
    if leaked_files:
        preview = "；".join(str(item) for item in leaked_files[:5])
        raise RuntimeError(f"分发包安全校验失败：运行目录仍包含 {len(leaked_files)} 个文件，示例：{preview}")


def ensure_no_local_config(package_dir: Path) -> None:
    # 该函数避免把本机 config.json 带出去，让目标电脑首次启动时生成自己的配置。
    config_path = Path(package_dir) / "config.json"
    if config_path.exists():
        raise RuntimeError(f"分发包安全校验失败：不应携带本机配置文件 {config_path}")


def ensure_pack_config_version(package_dir: Path, expected_version: str) -> None:
    # 该函数确认分发包版本配置和产物目录名来自同一个版本源。
    config_path = Path(package_dir) / "打包配置.json"
    if not config_path.exists():
        raise RuntimeError("分发包安全校验失败：缺少打包配置.json")
    raw = json.loads(config_path.read_text(encoding="utf-8-sig"))
    version = str(raw.get("displayVersion") or "").strip()
    if version != expected_version:
        raise RuntimeError(f"分发包安全校验失败：版本不一致，期望={expected_version}，实际={version}")


def ensure_distribution_is_clean(package_dir: Path, expected_version: str) -> None:
    # 该函数集中执行分发包隐私闸门，任一敏感残留都直接阻止打包。
    ensure_no_local_config(package_dir)
    ensure_runtime_has_no_login_state(package_dir)
    ensure_pack_config_version(package_dir, expected_version)


__all__ = [
    "collect_files",
    "ensure_distribution_is_clean",
    "ensure_no_local_config",
    "ensure_pack_config_version",
    "ensure_runtime_has_no_login_state",
]
