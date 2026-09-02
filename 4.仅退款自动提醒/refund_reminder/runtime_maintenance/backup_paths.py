# 该文件用于把自动迁移数据统一放到当前硬盘根目录的备份文件夹。
from __future__ import annotations

from pathlib import Path


def get_backup_root(project_root: Path) -> Path:
    # 该函数用于定位当前硬盘根目录下的备份文件夹，避免备份散落在项目内。
    root = Path(project_root).resolve().anchor
    if not root:
        raise RuntimeError(f"定位备份文件夹失败：无法识别项目所在硬盘，project_root={project_root}")
    return Path(root) / "备份文件夹"


def build_project_backup_path(project_root: Path, *parts: str) -> Path:
    # 该函数用于生成项目专属备份路径，并校验目标不会越出备份根目录。
    backup_root = get_backup_root(project_root)
    target = backup_root / Path(project_root).resolve().name
    for part in parts:
        target = target / str(part)
    resolved_root = backup_root.resolve()
    resolved_target = target.resolve() if target.exists() else Path(str(target)).absolute()
    if not str(resolved_target).lower().startswith(str(resolved_root).lower()):
        raise RuntimeError(f"生成备份路径失败：目标路径越界，target={resolved_target}")
    return target


__all__ = ["build_project_backup_path", "get_backup_root"]
