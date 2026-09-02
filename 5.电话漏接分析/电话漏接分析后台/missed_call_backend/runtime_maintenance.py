"""该文件负责启动时自动迁移可再生运行垃圾，避免项目目录长期膨胀。"""
from __future__ import annotations

import json
import time
from pathlib import Path

from .backup_utils import move_path_to_backup
from .logging_utils import write_log
from .paths import (
    BROWSER_PROFILE_ROOT,
    DOWNLOAD_OUTPUT_DIR,
    DOWNLOAD_RECORD_DIR,
    LATEST_DOWNLOAD_RESULT_FILE,
    LOG_FILE,
    PROJECT_TEMP_DIR,
)

TEMP_MAX_AGE_SECONDS = 24 * 60 * 60
DOWNLOAD_KEEP_COUNT = 80
DOWNLOAD_RECORD_KEEP_COUNT = 30
BROWSER_CACHE_DIR_NAMES = {
    "Cache",
    "Code Cache",
    "GPUCache",
    "ShaderCache",
    "GrShaderCache",
    "DawnCache",
    "Crashpad",
    "BrowserMetrics",
    "component_crx_cache",
    "ProvenanceData",
    "ProvenanceDataAllowList",
    "Safe Browsing",
    "OptimizationHints",
    "optimization_guide_model_store",
    "CacheStorage",
}
BROWSER_CACHE_FILE_PREFIXES = ("BrowserMetrics",)


def reset_runtime_log() -> None:
    """启动时只保留本次日志，避免历史日志越跑越大。"""
    LOG_FILE.write_text("", encoding="utf-8")


def ensure_runtime_directories() -> None:
    """创建运行所需目录，后续功能只管读写自己的目录。"""
    PROJECT_TEMP_DIR.mkdir(exist_ok=True)
    DOWNLOAD_OUTPUT_DIR.mkdir(exist_ok=True)
    DOWNLOAD_RECORD_DIR.mkdir(exist_ok=True)
    BROWSER_PROFILE_ROOT.mkdir(parents=True, exist_ok=True)


def newest_first(paths: list[Path]) -> list[Path]:
    """按修改时间从新到旧排序，用于保留最近必要数据。"""
    return sorted(paths, key=lambda item: item.stat().st_mtime if item.exists() else 0, reverse=True)


def move_stale_temp_entries(now_timestamp: float | None = None) -> int:
    """迁移超过一天的临时文件，临时目录不参与长期保存。"""
    now_timestamp = time.time() if now_timestamp is None else now_timestamp
    moved_count = 0
    if not PROJECT_TEMP_DIR.exists():
        return moved_count
    for path in PROJECT_TEMP_DIR.iterdir():
        if now_timestamp - path.stat().st_mtime <= TEMP_MAX_AGE_SECONDS:
            continue
        if move_path_to_backup(path, "tmp") is not None:
            moved_count += 1
    return moved_count


def move_old_download_files() -> int:
    """只保留最近一批下载文件，旧导出文件已经被结果记录复制后可迁出项目。"""
    if not DOWNLOAD_OUTPUT_DIR.exists():
        return 0
    files = newest_first([path for path in DOWNLOAD_OUTPUT_DIR.iterdir() if path.is_file()])
    moved_count = 0
    for path in files[DOWNLOAD_KEEP_COUNT:]:
        if move_path_to_backup(path, "downloads") is not None:
            moved_count += 1
    return moved_count


def read_latest_record_id() -> str:
    """读取 latest 指针，历史记录清理时永远保护当前页面会读取的记录。"""
    if not LATEST_DOWNLOAD_RESULT_FILE.exists():
        return ""
    payload = json.loads(LATEST_DOWNLOAD_RESULT_FILE.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise RuntimeError("运行维护失败：latest_download_result.json 根节点必须是对象")
    return str(payload.get("recordId") or "")


def move_old_download_records() -> int:
    """保留最新记录和最近一批历史记录，避免 download_records 无限增长。"""
    if not DOWNLOAD_RECORD_DIR.exists():
        return 0
    latest_record_id = read_latest_record_id()
    record_dirs = newest_first([path for path in DOWNLOAD_RECORD_DIR.iterdir() if path.is_dir()])
    protected_names = {latest_record_id}
    protected_names.update(path.name for path in record_dirs[:DOWNLOAD_RECORD_KEEP_COUNT])
    moved_count = 0
    for path in record_dirs:
        if path.name in protected_names:
            continue
        if move_path_to_backup(path, "download_records") is not None:
            moved_count += 1
    return moved_count


def has_selected_ancestor(path: Path, selected_paths: set[Path]) -> bool:
    """判断候选目录是否已经被更上层候选覆盖，避免重复迁移。"""
    current = path.parent
    while current != current.parent:
        if current in selected_paths:
            return True
        current = current.parent
    return False


def browser_cache_candidates() -> list[Path]:
    """按固定白名单找浏览器可再生缓存，不碰 Cookies、Local State 和登录库。"""
    if not BROWSER_PROFILE_ROOT.exists():
        return []
    raw_candidates = [path for path in BROWSER_PROFILE_ROOT.rglob("*") if path.is_dir() and path.name in BROWSER_CACHE_DIR_NAMES]
    selected: set[Path] = set()
    for path in sorted(raw_candidates, key=lambda item: len(item.parts)):
        if not has_selected_ancestor(path, selected):
            selected.add(path)
    return sorted(selected, key=lambda item: len(item.parts), reverse=True)


def browser_metric_file_candidates() -> list[Path]:
    """迁移浏览器指标文件，这类文件可再生且容易积累。"""
    if not BROWSER_PROFILE_ROOT.exists():
        return []
    return [path for path in BROWSER_PROFILE_ROOT.rglob("*") if path.is_file() and path.name.startswith(BROWSER_CACHE_FILE_PREFIXES)]


def move_browser_cache_entries() -> int:
    """迁移浏览器缓存白名单条目，让登录状态和可再生缓存物理分离。"""
    moved_count = 0
    for path in browser_cache_candidates() + browser_metric_file_candidates():
        if move_path_to_backup(path, "browser_cache") is not None:
            moved_count += 1
    return moved_count


def format_maintenance_summary(summary: dict[str, int]) -> str:
    """把维护结果压成一行日志，避免定时维护刷屏。"""
    return (
        f"浏览器缓存={summary['browserCache']} "
        f"临时={summary['tempEntries']} "
        f"下载={summary['downloadFiles']} "
        f"历史记录={summary['downloadRecords']}"
    )


def run_runtime_maintenance(log_action: str) -> dict[str, int]:
    """执行一次运行数据维护，启动和定时任务共用同一套规则。"""
    summary = {
        "browserCache": move_browser_cache_entries(),
        "tempEntries": move_stale_temp_entries(),
        "downloadFiles": move_old_download_files(),
        "downloadRecords": move_old_download_records(),
    }
    write_log(log_action, "运行数据", format_maintenance_summary(summary))
    return summary


def run_startup_maintenance() -> dict[str, int]:
    """启动时执行一次自动维护，避免带着历史垃圾继续运行。"""
    return run_runtime_maintenance("启动维护")


def run_periodic_maintenance() -> dict[str, int]:
    """运行中定时执行自动维护，避免长时间打开后继续膨胀。"""
    return run_runtime_maintenance("定时维护")
