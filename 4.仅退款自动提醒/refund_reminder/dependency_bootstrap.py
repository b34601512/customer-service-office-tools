#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib
import subprocess
import sys
from pathlib import Path

from .logger import log

_MODULE = "refund_reminder.dependency_bootstrap"
REQUIRED_MODULES = ("playwright.sync_api",)


def project_root() -> Path:
    # 该函数用于稳定定位项目根目录，避免批处理从其他目录启动时找错依赖清单。
    return Path(__file__).resolve().parents[1]


def missing_required_modules(module_names: tuple[str, ...] = REQUIRED_MODULES) -> tuple[str, ...]:
    # 该函数只判断依赖能否导入，不在这里吞掉错误，方便后续日志暴露真实缺口。
    missing: list[str] = []
    for module_name in module_names:
        try:
            importlib.import_module(module_name)
        except Exception as exc:
            missing.append(f"{module_name}（{exc}）")
    return tuple(missing)


def install_requirements(requirements_path: Path) -> None:
    # 该函数把 Python 依赖安装到当前解释器，保证一键启动和实际运行使用同一个环境。
    path = Path(requirements_path)
    if not path.exists():
        raise RuntimeError(f"缺少依赖清单，无法补齐 Python 依赖：{path}")
    command = [sys.executable, "-m", "pip", "install", "-r", str(path)]
    log("启动自检", "Python依赖", _MODULE, "install.start", python=sys.executable, requirements=str(path))
    result = subprocess.run(command, cwd=path.parent, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Python 依赖安装失败：退出码={result.returncode}，请检查网络或 pip 是否可用")
    log("启动自检", "Python依赖", _MODULE, "install.done", python=sys.executable)


def ensure_runtime_dependencies() -> None:
    # 该函数用于在后台启动前补齐依赖，避免用户点击「打开ERP」后才看到缺包红卡。
    missing = missing_required_modules()
    if not missing:
        log("启动自检", "Python依赖", _MODULE, "check.ok", python=sys.executable)
        return
    log("启动自检", "Python依赖", _MODULE, "check.missing", missing="；".join(missing))
    install_requirements(project_root() / "requirements.txt")
    remaining = missing_required_modules()
    if remaining:
        raise RuntimeError(f"Python 依赖安装后仍不可导入：{'；'.join(remaining)}")
    log("启动自检", "Python依赖", _MODULE, "check.fixed", python=sys.executable)


def main() -> int:
    # 该函数提供批处理可调用入口，失败时让启动脚本直接停止并显示中文原因。
    ensure_runtime_dependencies()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "ensure_runtime_dependencies",
    "install_requirements",
    "missing_required_modules",
    "project_root",
]
