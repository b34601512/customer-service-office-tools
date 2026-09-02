#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Any, Iterable

from .logger import log


def timestamp_text() -> str:
    # 该函数用于生成稳定备份目录名，避免重打包覆盖历史产物。
    return time.strftime("%Y%m%d-%H%M%S")


def backup_root(project_root: Path, stamp: str) -> Path:
    # 该函数把旧产物统一移动到当前硬盘根目录备份文件夹。
    drive_root = Path(Path(project_root).anchor)
    return drive_root / "备份文件夹" / Path(project_root).name / "打包产物备份" / stamp


def move_existing_path(path: Path, project_root: Path, stamp: str) -> Path | None:
    # 该函数用于移动旧产物，不做硬删除。
    target = Path(path)
    if not target.exists():
        return None
    backup_dir = backup_root(project_root, stamp)
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / target.name
    index = 1
    while backup_path.exists():
        backup_path = backup_dir / f"{target.name}.{index}"
        index += 1
    shutil.move(str(target), str(backup_path))
    log("分发打包", "文件备份", "旧产物已移入备份", source=str(target), backup=str(backup_path))
    return backup_path


def prepare_output_dir(path: Path, project_root: Path, stamp: str) -> None:
    # 该函数用于创建干净输出目录，旧目录存在时先移入备份。
    move_existing_path(path, project_root, stamp)
    Path(path).mkdir(parents=True, exist_ok=True)


def copy_file(source: Path, target: Path) -> None:
    # 该函数用于复制单文件并自动创建父目录。
    if not Path(source).exists():
        raise RuntimeError(f"复制文件失败：源文件不存在 {source}")
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def copy_tree(source: Path, target: Path, *, ignore_names: Iterable[str] = (), ignore_patterns: Iterable[str] = ()) -> None:
    # 该函数用于复制目录并过滤缓存文件，避免把无关构建垃圾带进分发包。
    if not Path(source).exists():
        raise RuntimeError(f"复制目录失败：源目录不存在 {source}")
    ignore = shutil.ignore_patterns(*tuple(ignore_names), *tuple(ignore_patterns))
    shutil.copytree(source, target, ignore=ignore, dirs_exist_ok=True)


def write_text(path: Path, text: str) -> None:
    # 该函数用于写入 UTF-8 文本文件，避免客服电脑中文乱码。
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(str(text), encoding="utf-8")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    # 该函数用于写入 UTF-8 JSON 文件，避免配置格式散落在多处。
    write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def zip_directory(source_dir: Path, zip_path: Path, project_root: Path, stamp: str) -> Path:
    # 该函数用于生成 zip 分发包，旧 zip 先移入备份。
    move_existing_path(zip_path, project_root, stamp)
    base_name = str(Path(zip_path).with_suffix(""))
    archive_path = shutil.make_archive(base_name, "zip", root_dir=source_dir)
    return Path(archive_path)


__all__ = [
    "backup_root",
    "copy_file",
    "copy_tree",
    "move_existing_path",
    "prepare_output_dir",
    "timestamp_text",
    "write_json",
    "write_text",
    "zip_directory",
]
