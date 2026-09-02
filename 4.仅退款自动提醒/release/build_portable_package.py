#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from release.file_ops import copy_file, copy_tree, move_existing_path, prepare_output_dir, timestamp_text, write_text, zip_directory
from release.logger import log
from release.package_safety_guard import ensure_distribution_is_clean
from release.release_info import read_release_info

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_ROOT = PROJECT_ROOT / "dist"
REQUIREMENTS_FILE = PROJECT_ROOT / "requirements.txt"
PYTHON_IGNORE_NAMES = ("__pycache__", "test", "tests", "idlelib", "ensurepip")
PYTHON_IGNORE_PATTERNS = ("*.pyc", "*.pyo", "*.dist-info\\RECORD")
PROJECT_IGNORE_NAMES = ("__pycache__", ".git", ".pytest_cache", ".mypy_cache")
PROJECT_IGNORE_PATTERNS = ("*.pyc", "*.pyo")


def portable_python_source() -> Path:
    # 该函数用于定位当前可运行项目的 Python 环境，分发包会内置这套运行时。
    return Path(sys.base_prefix).resolve()


def write_launcher_files(package_dir: Path) -> None:
    # 该函数写入分发包启动脚本，让客服电脑不需要安装 Python。
    content = "\r\n".join(
        [
            "@echo off",
            "setlocal",
            "chcp 65001 >nul",
            'cd /d "%~dp0"',
            'set "PYTHON_EXE=%~dp0runtime\\python\\python.exe"',
            'if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"',
            '"%PYTHON_EXE%" run.py',
            "exit /b %ERRORLEVEL%",
            "",
        ]
    )
    for name in ("启动后台.bat", "一键启动.bat", "start.bat"):
        write_text(package_dir / name, content)


def write_customer_guide(package_dir: Path, display_version: str) -> None:
    # 该函数写入客服说明，减少目标电脑首次使用时的沟通成本。
    guide = [
        f"退款自动提醒 客服版 {display_version}",
        "",
        "使用步骤：",
        "1. 解压整个压缩包，不要直接在压缩包里双击运行。",
        "2. 双击“启动后台.bat”或“一键启动.bat”。",
        "3. 首次使用时点击“打开 ERP”，在受控浏览器里完成登录。",
        "4. 点击“启动监控”后，工具会读取退款未作废候选订单的操作日志，仅对今天更新退款状态且新进入未处理列表的订单提醒。",
        "",
        "注意事项：",
        "1. 分发包已经自带 Python 和依赖，不需要额外安装 Python、Playwright 或 pip。",
        "2. 分发包不会携带打包电脑上的 ERP 登录态、处理记录和日志。",
        "3. 目标电脑仍需安装 Chrome 或 Edge；如果未找到浏览器，请在后台配置浏览器路径。",
    ]
    write_text(package_dir / "客服使用说明.txt", "\r\n".join(guide) + "\r\n")


def create_clean_runtime_dirs(package_dir: Path) -> None:
    # 该函数只创建空运行目录，不携带当前电脑的浏览器资料和订单处理记录。
    for relative in ("runtime/browser_profiles", "logs"):
        (package_dir / relative).mkdir(parents=True, exist_ok=True)


def copy_project_files(package_dir: Path) -> None:
    # 该函数复制当前项目运行主体，不复制本机配置、日志、缓存和历史运行数据。
    root_files = ("run.py", "panel.py", "app_entry.py", "README.md", "打包配置.json", "requirements.txt")
    for file_name in root_files:
        copy_file(PROJECT_ROOT / file_name, package_dir / file_name)
    copy_tree(
        PROJECT_ROOT / "refund_reminder",
        package_dir / "refund_reminder",
        ignore_names=PROJECT_IGNORE_NAMES,
        ignore_patterns=PROJECT_IGNORE_PATTERNS,
    )


def copy_python_runtime(package_dir: Path) -> None:
    # 该函数复制当前 Python 运行时，确保目标电脑没有 Python 环境也能运行。
    source = portable_python_source()
    target = package_dir / "runtime" / "python"
    log("分发打包", "Python运行时", "开始复制", source=str(source), target=str(target))
    copy_tree(source, target, ignore_names=PYTHON_IGNORE_NAMES, ignore_patterns=PYTHON_IGNORE_PATTERNS)
    python_exe = target / "python.exe"
    if not python_exe.exists():
        raise RuntimeError(f"复制 Python 运行时失败：未找到 {python_exe}")
    log("分发打包", "Python运行时", "复制完成", python=str(python_exe))


def install_python_dependencies(package_dir: Path) -> None:
    # 该函数把依赖装入分发包 Python，避免目标电脑首次运行再联网补包。
    python_exe = package_dir / "runtime" / "python" / "python.exe"
    if not REQUIREMENTS_FILE.exists():
        raise RuntimeError(f"分发打包失败：缺少依赖清单 {REQUIREMENTS_FILE}")
    command = [str(python_exe), "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)]
    log("分发打包", "Python依赖", "开始安装", command=" ".join(command))
    result = subprocess.run(command, cwd=PROJECT_ROOT, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"分发包 Python 依赖安装失败，退出码={result.returncode}")
    log("分发打包", "Python依赖", "安装完成", python=str(python_exe))


def build_package() -> tuple[Path, Path]:
    # 该函数统一完成目录准备、主体复制、安全校验和 zip 压缩。
    release_info = read_release_info(PROJECT_ROOT)
    stamp = timestamp_text()
    package_dir = DIST_ROOT / release_info.package_dir_name
    zip_path = DIST_ROOT / f"{release_info.package_dir_name}.zip"

    log("分发打包", "版本", "读取发布信息", version=release_info.display_version)
    prepare_output_dir(package_dir, PROJECT_ROOT, stamp)
    DIST_ROOT.mkdir(parents=True, exist_ok=True)
    copy_project_files(package_dir)
    write_launcher_files(package_dir)
    create_clean_runtime_dirs(package_dir)
    copy_python_runtime(package_dir)
    install_python_dependencies(package_dir)
    write_customer_guide(package_dir, release_info.display_version)
    ensure_distribution_is_clean(package_dir, release_info.display_version)
    archive_path = zip_directory(package_dir, zip_path, PROJECT_ROOT, stamp)
    log("分发打包", "客服分发包", "导出完成", directory=str(package_dir), zip=str(archive_path))
    return package_dir, archive_path


def run_package_check(package_dir: Path) -> None:
    # 该函数用分发包内置 Python 跑启动自检，证明目标机无需本机 Python 环境。
    python_exe = package_dir / "runtime" / "python" / "python.exe"
    command = [str(python_exe), "run.py", "--check"]
    log("分发打包", "自检", "开始", command=" ".join(command))
    result = subprocess.run(command, cwd=package_dir, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"分发包自检失败，退出码={result.returncode}")
    cleanup_self_check_outputs(package_dir)
    log("分发打包", "自检", "通过", package=str(package_dir))


def cleanup_self_check_outputs(package_dir: Path) -> None:
    # 该函数把自检生成的配置和日志移到备份，保持分发目录不携带本机运行痕迹。
    stamp = timestamp_text()
    for relative in ("config.json", "logs"):
        moved = move_existing_path(package_dir / relative, PROJECT_ROOT, stamp)
        if moved:
            log("分发打包", "自检", "已清理自检产物", path=str(moved))
    (package_dir / "logs").mkdir(parents=True, exist_ok=True)


def main() -> int:
    # 该函数是一键导出入口，失败时直接抛中文错误并返回非零退出码。
    package_dir, _archive_path = build_package()
    run_package_check(package_dir)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log("分发打包", "客服分发包", "导出失败", reason=str(exc))
        raise SystemExit(1)
