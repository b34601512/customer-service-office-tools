#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

from .logger import log

_MODULE = "clipboard_relay.runtime_cleanup"
_RUNTIME_ARTIFACTS = (
    "logs",
    ".pytest_cache",
)
_CACHE_SCAN_EXCLUDED_PARTS = {
    ".git",
    ".pyinstaller_build",
    ".venv",
    "__pypackages__",
    "build",
    "dist",
    "logs",
    "node_modules",
    "发布包",
    "runtime",
    "venv",
    "python_env",
}


@dataclass(frozen=True)
class RuntimeBloatPolicy:
    # 该对象用于集中放置运行膨胀安全线，避免清理阈值散落在不同文件里。
    max_startup_log_bytes: int = 10 * 1024 * 1024
    max_cache_bytes: int = 20 * 1024 * 1024
    maintenance_interval_sec: float = 300.0


DEFAULT_RUNTIME_BLOAT_POLICY = RuntimeBloatPolicy()


def get_backup_folder_for_cleanup(app_root: Path, *, run_id: str | None = None, reason: str = "启动清理") -> Path:
    # 该函数用于把启动清理产物统一移到项目所在硬盘根目录的备份文件夹。
    root = Path(app_root).resolve()
    drive_root = Path(root.anchor)
    if not str(drive_root):
        raise RuntimeError(f"启动清理失败：无法识别项目所在硬盘根目录，当前路径={root}")
    cleanup_id = str(run_id or datetime.now().strftime("%Y%m%d_%H%M%S"))
    return drive_root / "备份文件夹" / f"响应时间_{reason}_{cleanup_id}"


def _artifact_backup_path(backup_root: Path, relative_path: str) -> Path:
    # 该函数用于按原相对路径保存备份，方便需要时回看旧运行产物。
    return Path(backup_root) / Path(relative_path.replace("/", "\\"))


def move_runtime_artifact_to_backup(app_root: Path, relative_path: str, backup_root: Path) -> Path | None:
    # 该函数用于移动单个运行产物，配置文件不走这里，避免用户设置丢失。
    source = Path(app_root) / Path(relative_path)
    if not source.exists():
        return None
    target = _artifact_backup_path(Path(backup_root), relative_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        suffix = datetime.now().strftime("%H%M%S_%f")
        target = target.with_name(f"{target.name}_{suffix}")
    shutil.move(str(source), str(target))
    return target


def get_path_size_bytes(path: Path) -> int:
    # 该函数用于轻量计算单个文件或目录大小，只服务膨胀判断，不做全盘扫描。
    target = Path(path)
    if not target.exists():
        return 0
    if target.is_file():
        return int(target.stat().st_size)
    total_bytes = 0
    pending = [target]
    while pending:
        current = pending.pop()
        for child in current.iterdir():
            if child.is_dir() and not child.is_symlink():
                pending.append(child)
                continue
            total_bytes += int(child.stat().st_size)
    return total_bytes


def iter_source_cache_directories(app_root: Path) -> list[Path]:
    # 该函数用于只在源码侧寻找 Python 缓存，从入口就避开依赖、发布包和运行目录。
    root = Path(app_root).resolve()
    cache_dirs: list[Path] = []
    pending = [root]
    while pending:
        current = pending.pop()
        for child in current.iterdir():
            if not child.is_dir() or child.is_symlink():
                continue
            if child.name in _CACHE_SCAN_EXCLUDED_PARTS:
                continue
            if child.name == "__pycache__":
                cache_dirs.append(child)
                continue
            pending.append(child)
    return sorted(cache_dirs)


def get_source_cache_size_bytes(app_root: Path) -> int:
    # 该函数用于统计源码缓存总大小，超过安全线后再统一搬走。
    return sum(get_path_size_bytes(cache_dir) for cache_dir in iter_source_cache_directories(app_root))


def _move_source_cache_directories(app_root: Path, backup_root: Path) -> list[Path]:
    # 该函数用于搬走源码侧 Python 缓存，避免依赖目录和用户数据被误处理。
    root = Path(app_root).resolve()
    moved: list[Path] = []
    for cache_dir in iter_source_cache_directories(root):
        if not cache_dir.exists():
            continue
        relative_path = str(cache_dir.relative_to(root))
        target = move_runtime_artifact_to_backup(root, relative_path, backup_root)
        if target is not None:
            moved.append(target)
    return moved


def _move_large_startup_log_if_needed(app_root: Path, backup_root: Path, policy: RuntimeBloatPolicy) -> Path | None:
    # 该函数用于处理单个启动日志过大问题，不搬整个日志目录，避免运行中写日志失败。
    root = Path(app_root).resolve()
    startup_log = root / "logs" / "startup.log"
    if get_path_size_bytes(startup_log) <= int(policy.max_startup_log_bytes):
        return None
    moved = move_runtime_artifact_to_backup(root, "logs/startup.log", backup_root)
    startup_log.parent.mkdir(parents=True, exist_ok=True)
    startup_log.write_text("启动日志已因过大自动搬到备份文件夹，本文件从这里继续记录。\n", encoding="utf-8")
    (startup_log.parent / "last_startup.log").write_text(str(startup_log), encoding="utf-8")
    return moved


def _move_artifact_if_too_large(app_root: Path, relative_path: str, backup_root: Path, max_bytes: int) -> Path | None:
    # 该函数用于按阈值搬走一个可重建运行产物，不处理用户配置。
    root = Path(app_root).resolve()
    source = root / Path(relative_path)
    if get_path_size_bytes(source) <= int(max_bytes):
        return None
    return move_runtime_artifact_to_backup(root, relative_path, backup_root)


def cleanup_previous_runtime_artifacts(app_root: Path, *, backup_root: Path | None = None, prepare_browser_profiles: Callable[[Path], None] | None = None) -> list[Path]:
    # 该函数用于启动前清掉上一次运行产物，只保留用户配置和源码。
    root = Path(app_root).resolve()
    destination_root = Path(backup_root) if backup_root is not None else get_backup_folder_for_cleanup(root)
    moved: list[Path] = []
    if prepare_browser_profiles is not None:
        # 浏览器资料保存 Cookie 登录态，只关闭残留进程，不搬走资料目录。
        prepare_browser_profiles(root / "runtime" / "browser_profiles")
    for relative_path in _RUNTIME_ARTIFACTS:
        target = move_runtime_artifact_to_backup(root, relative_path, destination_root)
        if target is not None:
            moved.append(target)
    moved.extend(_move_source_cache_directories(root, destination_root))
    if moved:
        log("清理", "启动产物已搬走", _MODULE, "cleanup_previous_runtime_artifacts", count=len(moved), backup=str(destination_root))
    return moved


def cleanup_live_runtime_bloat(app_root: Path, *, policy: RuntimeBloatPolicy = DEFAULT_RUNTIME_BLOAT_POLICY, backup_root: Path | None = None) -> list[Path]:
    # 该函数用于运行中轻量处理膨胀产物，只碰不会破坏当前会话的对象。
    root = Path(app_root).resolve()
    destination_root = Path(backup_root) if backup_root is not None else get_backup_folder_for_cleanup(root, reason="运行体检")
    moved: list[Path] = []
    moved_log = _move_large_startup_log_if_needed(root, destination_root, policy)
    if moved_log is not None:
        moved.append(moved_log)
    moved_cache = _move_artifact_if_too_large(root, ".pytest_cache", destination_root, policy.max_cache_bytes)
    if moved_cache is not None:
        moved.append(moved_cache)
    if get_source_cache_size_bytes(root) > int(policy.max_cache_bytes):
        moved.extend(_move_source_cache_directories(root, destination_root))
    if moved:
        log("清理", "运行膨胀已搬走", _MODULE, "cleanup_live_runtime_bloat", count=len(moved), backup=str(destination_root))
    return moved


def cleanup_shutdown_runtime_artifacts(app_root: Path, *, backup_root: Path | None = None) -> list[Path]:
    # 该函数用于程序正常退出后搬走可重建缓存，浏览器资料必须保留登录态。
    root = Path(app_root).resolve()
    destination_root = Path(backup_root) if backup_root is not None else get_backup_folder_for_cleanup(root, reason="退出清理")
    moved: list[Path] = []
    for relative_path in (".pytest_cache",):
        target = move_runtime_artifact_to_backup(root, relative_path, destination_root)
        if target is not None:
            moved.append(target)
    moved.extend(_move_source_cache_directories(root, destination_root))
    if moved:
        log("清理", "退出产物已搬走", _MODULE, "cleanup_shutdown_runtime_artifacts", count=len(moved), backup=str(destination_root))
    return moved


__all__ = [
    "DEFAULT_RUNTIME_BLOAT_POLICY",
    "RuntimeBloatPolicy",
    "cleanup_live_runtime_bloat",
    "cleanup_previous_runtime_artifacts",
    "cleanup_shutdown_runtime_artifacts",
    "get_backup_folder_for_cleanup",
    "get_path_size_bytes",
    "get_source_cache_size_bytes",
    "iter_source_cache_directories",
    "move_runtime_artifact_to_backup",
]
