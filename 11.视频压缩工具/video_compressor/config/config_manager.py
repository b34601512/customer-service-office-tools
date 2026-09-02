from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from video_compressor.utils.action_logger import log_action
from video_compressor.utils.runtime_paths import get_app_base_dir

APP_BASE_DIR = get_app_base_dir()
CONFIG_PATH = APP_BASE_DIR / "config.json"
DEFAULT_OUTPUT_DIR = APP_BASE_DIR / "output"


@dataclass(slots=True)
class AppConfig:
    target_size_mb: float = 25.0
    output_dir: str = str(DEFAULT_OUTPUT_DIR)


def load_config() -> AppConfig:
    """加载配置文件，不存在就写入一份默认配置。"""
    if not CONFIG_PATH.exists():
        config = AppConfig()
        save_config(config)
        log_action("配置主线:初始化", "配置模块", "创建默认配置", f"配置文件={CONFIG_PATH}")
        return config

    try:
        raw_data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"配置文件不是合法的 JSON：{CONFIG_PATH}") from exc

    config = AppConfig(
        target_size_mb=float(raw_data.get("target_size_mb", 25.0)),
        output_dir=str(Path(raw_data.get("output_dir", DEFAULT_OUTPUT_DIR)).resolve()),
    )

    log_action(
        "配置主线:读取",
        "配置模块",
        "加载配置",
        f"目标大小={config.target_size_mb}MB 输出目录={config.output_dir}",
    )
    return config


def save_config(config: AppConfig) -> None:
    """保存配置，让 GUI 和 CLI 后续都能共用最近一次参数。"""
    CONFIG_PATH.write_text(json.dumps(asdict(config), ensure_ascii=False, indent=2), encoding="utf-8")
    log_action("配置主线:写入", "配置模块", "保存配置", f"配置文件={CONFIG_PATH}")
