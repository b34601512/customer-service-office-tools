"""该文件集中管理项目路径，避免运行数据路径散落在业务代码里。"""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_TEMP_DIR = BASE_DIR / "tmp"
PROJECT_TEMP_DIR.mkdir(exist_ok=True)
os.environ["TEMP"] = str(PROJECT_TEMP_DIR)
os.environ["TMP"] = str(PROJECT_TEMP_DIR)

LOG_FILE = BASE_DIR / "运行日志.log"
RUNTIME_DIR = BASE_DIR / "runtime"
BROWSER_PROFILE_ROOT = RUNTIME_DIR / "browser_profiles"
DOWNLOAD_BROWSER_PROFILE_DIR = BROWSER_PROFILE_ROOT / "phone_data_downloader"
DOWNLOAD_OUTPUT_DIR = BASE_DIR / "downloads"
DOWNLOAD_RECORD_DIR = BASE_DIR / "download_records"

DOWNLOAD_CONFIG_FILE = BASE_DIR / "download_config.json"
FOLLOWUP_STATE_FILE = BASE_DIR / "followup_state.json"
AGENT_MAPPING_FILE = BASE_DIR / "agent_mapping.json"
LATEST_DOWNLOAD_RESULT_FILE = BASE_DIR / "latest_download_result.json"
COMPLAINT_CONFIG_FILE = BASE_DIR / "complaint_config.json"

ANALYSIS_SCHEMA_VERSION = 9
# 真实投诉接收号码在本地 complaint_config.json 中维护；这里只是文件缺失时的占位默认值（不入库）。
DEFAULT_COMPLAINT_RECEIVER_PHONE = "10000000000"
DEFAULT_AGENT_MAPPING: dict[str, str] = {
    # 真实座席映射在本地 agent_mapping.json 中维护；这里只是文件缺失时的示例占位（不入库）。
    "8001": "示例客服1",
    "8002": "示例客服2",
    "8003": "示例客服3",
    "8005": "示例客服5",
    "8009": "示例客服9",
}
FOLLOWUP_NOTE_LIMIT = 500
CONTACT_NAME_LIMIT = 80

ACTIVE_AUTO_DOWNLOAD_STATUSES = {"queued", "running"}
