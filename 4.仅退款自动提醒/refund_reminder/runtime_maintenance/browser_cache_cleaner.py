# 该文件用于清理受控浏览器里可以重建的缓存目录。
from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

from ..logger import log

MODULE_NAME = "refund_reminder.runtime_maintenance.browser_cache_cleaner"
REBUILDABLE_CACHE_DIR_NAMES = {
    "BrowserMetrics",
    "Cache",
    "Code Cache",
    "Crashpad",
    "DawnCache",
    "GPUCache",
    "GrShaderCache",
    "Safe Browsing",
    "ShaderCache",
    "WasmTtsEngine",
    "WidevineCdm",
    "ZxcvbnData",
    "component_crx_cache",
    "MediaFoundationWidevineCdm",
}


@dataclass(frozen=True)
class BrowserCacheCleanupReport:
    removed_count: int
    removed_bytes: int
    removed_paths: tuple[Path, ...]


def clean_browser_profile_cache(profile_dir: Path) -> BrowserCacheCleanupReport:
    # 该函数用于删除受控浏览器可重建缓存，保留登录态和业务数据不动。
    root = Path(profile_dir)
    if not root.exists():
        return BrowserCacheCleanupReport(removed_count=0, removed_bytes=0, removed_paths=())
    targets = collect_rebuildable_cache_dirs(root)
    removed_paths: list[Path] = []
    removed_bytes = 0
    for target in targets:
        removed_bytes += directory_size(target)
        shutil.rmtree(target)
        removed_paths.append(target)
    if removed_paths:
        log("Runtime", "清理浏览器缓存", MODULE_NAME, "clean_browser_profile_cache", profile=str(root), count=len(removed_paths), bytes=removed_bytes)
    return BrowserCacheCleanupReport(removed_count=len(removed_paths), removed_bytes=removed_bytes, removed_paths=tuple(removed_paths))


def collect_rebuildable_cache_dirs(profile_dir: Path) -> tuple[Path, ...]:
    # 该函数用于只收集白名单缓存目录，避免误碰浏览器登录态文件。
    root = Path(profile_dir).resolve()
    if not root.exists():
        return ()
    targets: list[Path] = []
    for item in sorted(root.rglob("*"), key=lambda path: len(path.parts)):
        if not item.is_dir() or item.name not in REBUILDABLE_CACHE_DIR_NAMES:
            continue
        resolved = item.resolve()
        if resolved == root or not str(resolved).lower().startswith(str(root).lower()):
            raise RuntimeError(f"浏览器缓存清理失败：目标路径越界，target={resolved}")
        if any(is_parent_path(existing, resolved) for existing in targets):
            continue
        targets.append(resolved)
    return tuple(targets)


def directory_size(path: Path) -> int:
    # 该函数用于统计待清理缓存体积，方便日志确认控膨胀动作是否真实发生。
    total = 0
    for item in Path(path).rglob("*"):
        if item.is_file():
            total += int(item.stat().st_size)
    return total


def is_parent_path(parent: Path, child: Path) -> bool:
    # 该函数用于避免父缓存目录和子缓存目录重复清理。
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


__all__ = ["BrowserCacheCleanupReport", "clean_browser_profile_cache", "collect_rebuildable_cache_dirs"]
