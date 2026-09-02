"""该文件负责把运行维护移出的内容统一迁到项目外备份文件夹。"""
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from .paths import BASE_DIR


def get_backup_root() -> Path:
    """按当前硬盘根目录定位备份文件夹，避免备份回到项目内部。"""
    drive = BASE_DIR.drive or "D:"
    return Path(f"{drive}\备份文件夹")


def relative_project_path(source_path: Path) -> Path:
    """把项目内路径转成相对路径，备份时保留原目录线索。"""
    try:
        return source_path.resolve().relative_to(BASE_DIR.resolve())
    except ValueError as error:
        raise RuntimeError(f"备份失败：路径不在项目内，{source_path}") from error


def unique_backup_target(source_path: Path, category: str) -> Path:
    """生成不会覆盖旧备份的目标路径，避免多次维护互相覆盖。"""
    today = datetime.now().strftime("%Y%m%d")
    relative_path = relative_project_path(source_path)
    target = get_backup_root() / "电话漏接分析后台_自动维护" / category / today / relative_path
    if not target.exists():
        return target
    stamp = datetime.now().strftime("%H%M%S_%f")
    return target.with_name(f"{target.name}.{stamp}.bak")


def move_path_to_backup(source_path: Path, category: str) -> Path | None:
    """把指定文件或目录移动到备份文件夹，项目内不做硬删除。"""
    source_path = Path(source_path)
    if not source_path.exists():
        return None
    target_path = unique_backup_target(source_path, category)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source_path), str(target_path))
    return target_path
