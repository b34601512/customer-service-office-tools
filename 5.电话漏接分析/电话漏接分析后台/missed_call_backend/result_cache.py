"""该文件负责最新分析结果和历史记录缓存，清晰隔离缓存生命周期。"""
from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .analysis import analyze_raw_tables
from .logging_utils import write_log
from .paths import ANALYSIS_SCHEMA_VERSION, DOWNLOAD_RECORD_DIR, LATEST_DOWNLOAD_RESULT_FILE
from .raw_table_store import read_raw_tables
from .state_store import apply_followup_state, load_complaint_config, normalize_complaint_receiver_phones


def save_latest_download_result(result: dict[str, Any], source_files: dict[str, Path], source_type: str) -> None:
    """每次成功分析都创建独立记录目录，再用 latest 指针指向最新结果。"""
    saved_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    record_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    record_dir = DOWNLOAD_RECORD_DIR / record_id
    files_dir = record_dir / "files"
    files_dir.mkdir(parents=True, exist_ok=False)
    cached_files: dict[str, str] = {}
    for file_key, source_path in source_files.items():
        source_path = Path(source_path)
        if not source_path.exists():
            raise RuntimeError(f"保存最近下载记录失败：源文件不存在，{source_path}")
        target_path = files_dir / f"{file_key}{source_path.suffix.lower()}"
        shutil.copy2(source_path, target_path)
        cached_files[file_key] = str(target_path)

    result["analysisSchemaVersion"] = ANALYSIS_SCHEMA_VERSION
    result["latestRecord"] = {
        "id": record_id,
        "savedAt": saved_at,
        "sourceType": source_type,
        "recordDir": str(record_dir),
        "cachedFiles": cached_files,
    }
    result_file = record_dir / "result.json"
    result_file.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    payload = {
        "version": 1,
        "savedAt": saved_at,
        "sourceType": source_type,
        "recordId": record_id,
        "recordDir": str(record_dir),
        "resultFile": str(result_file),
    }
    LATEST_DOWNLOAD_RESULT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_log("保存缓存", "下载结果", f"记录={record_id} 候选号码={result.get('summary', {}).get('candidateCount', 0)}")


def find_cached_source_file(record_dir: Path, file_key: str) -> Path | None:
    """从历史记录目录里找到原始 Excel，保证旧缓存能按新口径重新分析。"""
    files_dir = record_dir / "files"
    for suffix in (".xls", ".xlsx"):
        candidate = files_dir / f"{file_key}{suffix}"
        if candidate.exists():
            return candidate
    return None


def rebuild_result_from_cached_files(payload: dict[str, Any], cached_result: dict[str, Any]) -> dict[str, Any]:
    """用缓存的三份原始表重新计算，避免页面继续展示旧判断口径。"""
    current_receiver_phones = load_complaint_config()["receiverPhones"]
    cached_receiver_phones = normalize_complaint_receiver_phones(
        cached_result.get("complaints", {}).get("receiverPhones") or cached_result.get("complaints", {}).get("receiverPhone")
    )
    if int(cached_result.get("analysisSchemaVersion") or 0) >= ANALYSIS_SCHEMA_VERSION and cached_receiver_phones == current_receiver_phones:
        return cached_result

    record_dir = Path(str(payload.get("recordDir") or ""))
    cached_files = cached_result.get("latestRecord", {}).get("cachedFiles", {})

    def cached_path(file_key: str) -> Path | None:
        """优先读取 result.json 里的明确路径，缺失时回到记录目录扫描。"""
        raw_path = str(cached_files.get(file_key) or "").strip() if isinstance(cached_files, dict) else ""
        return Path(raw_path) if raw_path else find_cached_source_file(record_dir, file_key)

    loss_path = cached_path("lossFile")
    inbound_path = cached_path("inboundFile")
    outbound_path = cached_path("outboundFile")
    if loss_path is None or inbound_path is None or outbound_path is None:
        return cached_result
    if not loss_path.exists() or not inbound_path.exists() or not outbound_path.exists():
        return cached_result

    raw_tables = read_raw_tables(
        {"lossFile": loss_path, "inboundFile": inbound_path, "outboundFile": outbound_path}
    )
    rebuilt_result = analyze_raw_tables(raw_tables)
    rebuilt_result["analysisSchemaVersion"] = ANALYSIS_SCHEMA_VERSION
    rebuilt_result["downloadedFiles"] = dict(cached_result.get("downloadedFiles") or {})
    rebuilt_result["latestRecord"] = dict(cached_result.get("latestRecord") or {})
    rebuilt_result["rawTables"] = raw_tables
    return rebuilt_result


def load_latest_download_result() -> dict[str, Any] | None:
    """读取最近一次自动下载分析结果，读取时重新合并最新处理状态。"""
    if not LATEST_DOWNLOAD_RESULT_FILE.exists():
        return None
    try:
        payload = json.loads(LATEST_DOWNLOAD_RESULT_FILE.read_text(encoding="utf-8-sig"))
    except Exception as error:
        raise RuntimeError(f"读取上次下载记录失败：{error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("读取上次下载记录失败：根节点必须是对象")
    result_file = Path(str(payload.get("resultFile") or ""))
    if not result_file.exists():
        raise RuntimeError(f"读取上次下载记录失败：结果文件不存在，{result_file}")
    cached_result = json.loads(result_file.read_text(encoding="utf-8-sig"))
    if not isinstance(cached_result, dict):
        raise RuntimeError("读取上次下载记录失败：result 必须是对象")
    result = rebuild_result_from_cached_files(payload, cached_result)
    current_receiver_phones = load_complaint_config()["receiverPhones"]
    cached_receiver_phones = normalize_complaint_receiver_phones(
        cached_result.get("complaints", {}).get("receiverPhones") or cached_result.get("complaints", {}).get("receiverPhone")
    )
    result_receiver_phones = normalize_complaint_receiver_phones(
        result.get("complaints", {}).get("receiverPhones") or result.get("complaints", {}).get("receiverPhone")
    )
    if (
        int(cached_result.get("analysisSchemaVersion") or 0) < ANALYSIS_SCHEMA_VERSION
        or cached_receiver_phones != current_receiver_phones
    ) and int(result.get("analysisSchemaVersion") or 0) >= ANALYSIS_SCHEMA_VERSION and result_receiver_phones == current_receiver_phones:
        result_file.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_log("升级缓存", "下载结果", f"记录={payload.get('recordId', '')} 版本={ANALYSIS_SCHEMA_VERSION} 投诉分机={','.join(current_receiver_phones)}")
    result = apply_followup_state(result)
    result["latestDownloadCache"] = {
        "savedAt": str(payload.get("savedAt") or ""),
        "sourceType": str(payload.get("sourceType") or ""),
        "recordId": str(payload.get("recordId") or ""),
        "recordDir": str(payload.get("recordDir") or ""),
    }
    return result
