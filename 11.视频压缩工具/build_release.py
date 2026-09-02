from __future__ import annotations

import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from video_compressor.app_metadata import APP_NAME, APP_VERSION
from video_compressor.utils.action_logger import log_action


PROJECT_ROOT = Path(__file__).resolve().parent
DIST_DIR = PROJECT_ROOT / "dist"
BUILD_DIR = PROJECT_ROOT / "build"
RELEASE_DIR = PROJECT_ROOT / "release"
SPEC_DIR = PROJECT_ROOT / "packaging"
VERSION_FILE_PATH = PROJECT_ROOT / "packaging" / "windows_version_info.txt"
PACKAGE_NAME = f"{APP_NAME}_v{APP_VERSION}"
BACKUP_ROOT = Path(PROJECT_ROOT.anchor) / "备份文件夹" / APP_NAME / "打包备份"


def backup_directory_if_exists(target_dir: Path) -> None:
    """把旧打包目录移动到备份文件夹，避免直接硬删除。"""
    if not target_dir.exists():
        return

    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_target = BACKUP_ROOT / f"{target_dir.name}_{timestamp}"
    shutil.move(str(target_dir), str(backup_target))
    log_action("打包主线:备份", "打包脚本", "移动旧目录", f"源目录={target_dir} 备份目录={backup_target}")


def build_release() -> Path:
    """执行 PyInstaller 打包，并把最终 exe 归档到 release 目录。"""
    for target_dir in (DIST_DIR, BUILD_DIR):
        backup_directory_if_exists(target_dir)

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--windowed",
        "--onefile",
        "--name",
        PACKAGE_NAME,
        "--specpath",
        str(SPEC_DIR),
        "--collect-all",
        "imageio_ffmpeg",
        "--hidden-import",
        "tkinter",
        "--hidden-import",
        "tkinter.ttk",
        "--version-file",
        str(VERSION_FILE_PATH),
        str(PROJECT_ROOT / "main.py"),
    ]

    log_action("打包主线:开始", "打包脚本", "执行 PyInstaller", f"版本=v{APP_VERSION}")
    subprocess.run(command, check=True, cwd=PROJECT_ROOT)

    release_target_dir = RELEASE_DIR / PACKAGE_NAME
    backup_directory_if_exists(release_target_dir)
    release_target_dir.mkdir(parents=True, exist_ok=True)

    built_exe_path = DIST_DIR / f"{PACKAGE_NAME}.exe"
    final_exe_path = release_target_dir / built_exe_path.name
    shutil.copy2(built_exe_path, final_exe_path)

    log_action("打包主线:完成", "打包脚本", "归档发布产物", f"产物={final_exe_path}")
    return final_exe_path


if __name__ == "__main__":
    final_exe = build_release()
    print(f"打包完成：{final_exe}")
