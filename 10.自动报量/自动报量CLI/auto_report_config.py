from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any


def clean_config_text(raw_value: Any) -> str:
    """清理配置中的文本字段。"""
    return str(raw_value if raw_value is not None else "").replace("\t", "").strip()


def split_config_lines(raw_value: Any) -> list[str]:
    """把多行配置转换成去重后的文本列表。"""
    if isinstance(raw_value, list):
        values = raw_value
    else:
        values = str(raw_value or "").splitlines()
    unique_values: list[str] = []
    for value in values:
        cleaned_value = clean_config_text(value)
        if cleaned_value and cleaned_value not in unique_values:
            unique_values.append(cleaned_value)
    return unique_values


def normalize_product_rows(product_rows: Any) -> list[dict[str, Any]]:
    """清理产品行映射，保持CLI和旧网页使用同一份映射事实。"""
    normalized_rows: list[dict[str, Any]] = []
    for product_row in product_rows or []:
        try:
            row_number = int(product_row.get("row", 0))
        except (AttributeError, TypeError, ValueError):
            continue
        normalized_row = {
            "row": row_number,
            "productName": clean_config_text(product_row.get("productName")),
            "stores": split_config_lines(product_row.get("stores")),
            "materialCodes": split_config_lines(product_row.get("materialCodes")),
        }
        if (
            row_number > 0
            and normalized_row["productName"]
            and normalized_row["stores"]
            and normalized_row["materialCodes"]
        ):
            normalized_rows.append(normalized_row)
    return sorted(
        normalized_rows,
        key=lambda item: (item["row"], item["productName"]),
    )


def normalize_product_name_for_preference(product_name: str) -> str:
    """去掉产品价格括号，生成稳定的重复料号优先名。"""
    return re.sub(r"（[^）]*）", "", clean_config_text(product_name)).replace(" ", "")


def build_material_preference_index(product_rows: list[dict[str, Any]]) -> dict[str, str]:
    """根据产品行顺序生成重复料号的默认优先产品。"""
    preference_index: dict[str, str] = {}
    for product_row in product_rows:
        preferred_product_name = normalize_product_name_for_preference(product_row["productName"])
        for material_code in product_row["materialCodes"]:
            preference_index.setdefault(material_code, preferred_product_name)
    return preference_index


def load_report_config_from_js(report_config_path: Path) -> dict[str, Any]:
    """读取现有网页配置中的JSON对象，不复制第二份业务配置。"""
    config_text = report_config_path.read_text(encoding="utf-8-sig")
    config_match = re.search(
        r"window\.REPORT_IMPORT_CONFIG\s*=\s*(\{.*\});\s*$",
        config_text,
        flags=re.DOTALL,
    )
    if not config_match:
        raise RuntimeError(f"无法读取报量配置：{report_config_path}")
    try:
        config = json.loads(config_match.group(1))
    except json.JSONDecodeError as error:
        raise RuntimeError(f"报量配置不是有效JSON：{error}") from error
    return normalize_report_config(config)


def normalize_report_config(config: dict[str, Any]) -> dict[str, Any]:
    """统一配置结构，避免后续模块各自猜测字段是否存在。"""
    normalized_config = deepcopy(config)
    normalized_config.setdefault("sourceColumns", {})
    normalized_config.setdefault("filters", {})
    normalized_config.setdefault("shift", {})
    normalized_config.setdefault("template", {})
    normalized_config["productRows"] = normalize_product_rows(normalized_config.get("productRows"))
    normalized_config["materialCodePreferredProductName"] = build_material_preference_index(
        normalized_config["productRows"]
    ) | {
        clean_config_text(key): clean_config_text(value)
        for key, value in (normalized_config.get("materialCodePreferredProductName") or {}).items()
        if clean_config_text(key) and clean_config_text(value)
    }
    return normalized_config


def merge_report_config(base_config: dict[str, Any], override_config: dict[str, Any] | None) -> dict[str, Any]:
    """只合并用户允许覆盖的配置，避免覆盖模板结构。"""
    if not override_config:
        return normalize_report_config(base_config)
    merged_config = deepcopy(base_config)
    for section_name in ("sourceColumns", "filters", "shift"):
        section_override = override_config.get(section_name)
        if isinstance(section_override, dict):
            merged_config[section_name] = {
                **merged_config.get(section_name, {}),
                **section_override,
            }
    if isinstance(override_config.get("productRows"), list):
        merged_config["productRows"] = override_config["productRows"]
    if isinstance(override_config.get("materialCodePreferredProductName"), dict):
        merged_config["materialCodePreferredProductName"] = override_config[
            "materialCodePreferredProductName"
        ]
    return normalize_report_config(merged_config)


def load_runtime_override_config(runtime_override_path: Path) -> dict[str, Any] | None:
    """读取本机可选覆盖配置，文件不存在时保持默认配置。"""
    if not runtime_override_path.exists():
        return None
    try:
        return json.loads(runtime_override_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"本机配置覆盖文件无法读取：{runtime_override_path}；{error}") from error


def load_runtime_report_config(report_config_path: Path, runtime_override_path: Path) -> dict[str, Any]:
    """读取默认配置并合并本机覆盖配置。"""
    base_config = load_report_config_from_js(report_config_path)
    return merge_report_config(base_config, load_runtime_override_config(runtime_override_path))


def save_runtime_override_config(runtime_override_path: Path, config: dict[str, Any]) -> None:
    """保存可迁移的本机配置覆盖，不改动默认配置文件。"""
    runtime_override_path.parent.mkdir(parents=True, exist_ok=True)
    serializable_config = {
        "sourceColumns": config.get("sourceColumns", {}),
        "filters": config.get("filters", {}),
        "shift": config.get("shift", {}),
        "productRows": normalize_product_rows(config.get("productRows")),
        "materialCodePreferredProductName": build_material_preference_index(
            normalize_product_rows(config.get("productRows"))
        ),
    }
    runtime_override_path.write_text(
        json.dumps(serializable_config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

