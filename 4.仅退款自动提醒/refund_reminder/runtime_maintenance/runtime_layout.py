# 该文件用于集中定义项目运行目录结构。
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .backup_paths import build_project_backup_path


@dataclass(frozen=True)
class RuntimeLayout:
    project_root: Path
    runtime_dir: Path
    browser_profiles_dir: Path
    control_center_profile_dir: Path
    handled_orders_path: Path
    handled_orders_archive_dir: Path
    monitor_stats_path: Path


def build_runtime_layout(project_root: Path) -> RuntimeLayout:
    # 该函数用于把运行目录路径集中到一个对象里，避免各模块散落拼路径。
    root = Path(project_root)
    runtime_dir = root / "runtime"
    return RuntimeLayout(
        project_root=root,
        runtime_dir=runtime_dir,
        browser_profiles_dir=runtime_dir / "browser_profiles",
        control_center_profile_dir=runtime_dir / "browser_profiles" / "control_center",
        handled_orders_path=runtime_dir / "handled_orders.json",
        handled_orders_archive_dir=build_project_backup_path(root, "运行数据迁移", "handled_orders"),
        monitor_stats_path=runtime_dir / "monitor_stats.json",
    )


__all__ = ["RuntimeLayout", "build_runtime_layout"]
