"""该文件负责本地配置和回访状态读写，业务分析不直接碰磁盘细节。"""
from __future__ import annotations

import json
import re
import time
from typing import Any

from .logging_utils import write_log
from .normalizers import normalize_agent_extension, normalize_phone
from .paths import (
    AGENT_MAPPING_FILE,
    COMPLAINT_CONFIG_FILE,
    CONTACT_NAME_LIMIT,
    DEFAULT_AGENT_MAPPING,
    DEFAULT_COMPLAINT_RECEIVER_PHONE,
    DOWNLOAD_BROWSER_PROFILE_DIR,
    DOWNLOAD_CONFIG_FILE,
    DOWNLOAD_OUTPUT_DIR,
    FOLLOWUP_NOTE_LIMIT,
    FOLLOWUP_STATE_FILE,
)


def load_followup_state() -> dict[str, dict[str, Any]]:
    """读取电话回访处理状态，备注和勾选状态必须独立于分析结果持久保存。"""
    if not FOLLOWUP_STATE_FILE.exists():
        return {}
    try:
        payload = json.loads(FOLLOWUP_STATE_FILE.read_text(encoding="utf-8-sig"))
    except Exception as error:
        raise RuntimeError(f"读取回访处理状态失败：{error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("读取回访处理状态失败：根节点必须是对象")
    records = payload.get("phones", {})
    if not isinstance(records, dict):
        raise RuntimeError("读取回访处理状态失败：phones 必须是对象")
    normalized: dict[str, dict[str, Any]] = {}
    for phone, record in records.items():
        if not isinstance(record, dict):
            raise RuntimeError(f"读取回访处理状态失败：号码记录必须是对象，phone={phone!r}")
        normalized_phone = normalize_phone(phone)
        if not normalized_phone:
            continue
        status = str(record.get("status") or "pending").strip()
        if status not in {"pending", "processing", "handled"}:
            status = "pending"
        note_text = str(record.get("noteText") or "").strip()
        if len(note_text) > FOLLOWUP_NOTE_LIMIT:
            raise RuntimeError(f"读取回访处理状态失败：号码 {normalized_phone} 的备注超过 {FOLLOWUP_NOTE_LIMIT} 个字")
        contact_name = str(record.get("contactName") or "").strip()
        if len(contact_name) > CONTACT_NAME_LIMIT:
            raise RuntimeError(f"读取回访处理状态失败：号码 {normalized_phone} 的客户姓名超过 {CONTACT_NAME_LIMIT} 个字")
        phone_note_text = str(record.get("phoneNoteText") or "").strip()
        if len(phone_note_text) > FOLLOWUP_NOTE_LIMIT:
            raise RuntimeError(f"读取回访处理状态失败：号码 {normalized_phone} 的号码档案超过 {FOLLOWUP_NOTE_LIMIT} 个字")
        normalized[normalized_phone] = {
            "phone": normalized_phone,
            "status": status,
            "noteText": note_text,
            "contactName": contact_name,
            "phoneNoteText": phone_note_text,
            "updatedAt": float(record.get("updatedAt") or 0),
        }
    return normalized


def save_followup_state(records: dict[str, dict[str, Any]]) -> None:
    """把电话回访处理状态写入 UTF-8 JSON，避免刷新或重启后丢失处理进度。"""
    payload = {
        "version": 1,
        "phones": {phone: records[phone] for phone in sorted(records)},
    }
    FOLLOWUP_STATE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_agent_mapping() -> dict[str, str]:
    """读取座席分机映射配置，让旧姓名可以按固定分机归并到当前客服名下。"""
    if not AGENT_MAPPING_FILE.exists():
        return dict(DEFAULT_AGENT_MAPPING)
    try:
        payload = json.loads(AGENT_MAPPING_FILE.read_text(encoding="utf-8-sig"))
    except Exception as error:
        raise RuntimeError(f"读取座席分机映射失败：{error}") from error
    mappings = payload.get("mappings", payload)
    if not isinstance(mappings, dict):
        raise RuntimeError("读取座席分机映射失败：mappings 必须是对象")
    normalized = {}
    for source_extension, target_name in mappings.items():
        source_text = normalize_agent_extension(source_extension)
        target_text = str(target_name or "").strip()
        if source_text and target_text:
            normalized[source_text] = target_text
    return normalized


def save_agent_mapping(mappings: dict[str, str]) -> dict[str, str]:
    """保存座席分机映射配置，空白映射直接忽略，避免统计名称被污染。"""
    normalized = {}
    for source_extension, target_name in mappings.items():
        source_text = normalize_agent_extension(source_extension)
        target_text = str(target_name or "").strip()
        if source_text and target_text:
            normalized[source_text] = target_text
    payload = {"version": 1, "mappings": dict(sorted(normalized.items()))}
    AGENT_MAPPING_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_log("保存配置", "座席分机映射", f"映射数量={len(normalized)}")
    return normalized


def normalize_complaint_receiver_phones(raw_phones: Any) -> list[str]:
    """把投诉座席分机统一解析为去重后的号码列表，兼容文本和 JSON 数组。"""
    raw_values = raw_phones if isinstance(raw_phones, (list, tuple, set)) else [raw_phones]
    normalized_phones: list[str] = []
    for raw_value in raw_values:
        for phone_text in re.split(r"[,，;；\s]+", str(raw_value or "").strip()):
            normalized_phone = normalize_agent_extension(phone_text)
            if normalized_phone and normalized_phone not in normalized_phones:
                normalized_phones.append(normalized_phone)
    return normalized_phones


def build_complaint_config(receiver_phones: list[str]) -> dict[str, Any]:
    """生成新旧字段并存的投诉配置，避免旧页面或缓存读取失败。"""
    if not receiver_phones:
        raise RuntimeError("投诉电话配置失败：投诉座席分机不能为空")
    primary_receiver_phone = receiver_phones[0]
    return {
        "receiverPhones": receiver_phones,
        "receiverExtensions": receiver_phones,
        "receiverPhone": primary_receiver_phone,
        "receiverExtension": primary_receiver_phone,
    }


def load_complaint_config() -> dict[str, Any]:
    """读取投诉电话配置，投诉座席分机集中配置，避免分析口径散落在代码里。"""
    default_receiver_phone = normalize_agent_extension(DEFAULT_COMPLAINT_RECEIVER_PHONE)
    if not COMPLAINT_CONFIG_FILE.exists():
        return build_complaint_config([default_receiver_phone])
    try:
        payload = json.loads(COMPLAINT_CONFIG_FILE.read_text(encoding="utf-8-sig"))
    except Exception as error:
        raise RuntimeError(f"读取投诉电话配置失败：{error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("读取投诉电话配置失败：根节点必须是对象")
    receiver_phones = normalize_complaint_receiver_phones(
        payload.get("receiverPhones") or payload.get("receiverPhone") or payload.get("receiverExtension") or default_receiver_phone
    )
    return build_complaint_config(receiver_phones)


def save_complaint_config(payload: dict[str, Any]) -> dict[str, Any]:
    """保存多个投诉电话座席分机，配置变化后分析层会按最新分机重新统计。"""
    if not isinstance(payload, dict):
        raise RuntimeError("保存投诉电话配置失败：请求内容必须是对象")
    receiver_phones = normalize_complaint_receiver_phones(
        payload.get("receiverPhones") or payload.get("receiverPhone") or payload.get("receiverExtension")
    )
    config = build_complaint_config(receiver_phones)
    COMPLAINT_CONFIG_FILE.write_text(json.dumps({"version": 1, **config}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_log("保存配置", "投诉电话", f"座席分机={','.join(receiver_phones)}")
    return config


def map_agent_name(extension: Any, raw_name: Any, mappings: dict[str, str]) -> str:
    """优先按座席分机映射为当前统计名称，未配置时保留导出表姓名。"""
    extension_text = normalize_agent_extension(extension)
    raw_name_text = str(raw_name or "").strip() or "未填写"
    return mappings.get(extension_text, raw_name_text)


def update_followup_state(
    phone: str,
    *,
    status: str | None = None,
    note_text: str | None = None,
    contact_name: str | None = None,
    phone_note_text: str | None = None,
) -> dict[str, Any]:
    """更新单个号码的回访处理状态，接口层只负责一个号码一次状态变更。"""
    normalized_phone = normalize_phone(phone)
    if not normalized_phone:
        raise RuntimeError("更新回访状态失败：号码不能为空")
    records = load_followup_state()
    current = records.get(
        normalized_phone,
        {"phone": normalized_phone, "status": "pending", "noteText": "", "contactName": "", "phoneNoteText": "", "updatedAt": 0},
    )
    next_status = str(status or current.get("status") or "pending").strip()
    if next_status not in {"pending", "processing", "handled"}:
        raise RuntimeError("更新回访状态失败：status 必须是 pending、processing 或 handled")
    next_note_text = str(current.get("noteText") or "" if note_text is None else note_text).strip()
    if len(next_note_text) > FOLLOWUP_NOTE_LIMIT:
        raise RuntimeError(f"保存回访备注失败：备注不能超过 {FOLLOWUP_NOTE_LIMIT} 个字")
    next_contact_name = str(current.get("contactName") or "" if contact_name is None else contact_name).strip()
    if len(next_contact_name) > CONTACT_NAME_LIMIT:
        raise RuntimeError(f"保存号码档案失败：号码是谁不能超过 {CONTACT_NAME_LIMIT} 个字")
    next_phone_note_text = str(current.get("phoneNoteText") or "" if phone_note_text is None else phone_note_text).strip()
    if len(next_phone_note_text) > FOLLOWUP_NOTE_LIMIT:
        raise RuntimeError(f"保存号码档案失败：长期备注不能超过 {FOLLOWUP_NOTE_LIMIT} 个字")
    updated = {
        "phone": normalized_phone,
        "status": next_status,
        "noteText": next_note_text,
        "contactName": next_contact_name,
        "phoneNoteText": next_phone_note_text,
        "updatedAt": time.time(),
    }
    records[normalized_phone] = updated
    save_followup_state(records)
    write_log("保存回访状态", "处理清单", f"号码={normalized_phone} 状态={next_status}")
    return updated


def apply_followup_state(result: dict[str, Any]) -> dict[str, Any]:
    """把本地处理状态合并到最新分析结果，让页面直接按待处理/已处理展示。"""
    state_records = load_followup_state()
    pending_count = 0
    processing_count = 0
    handled_count = 0
    for candidate in result.get("candidates", []):
        phone = normalize_phone(candidate.get("phone"))
        record = state_records.get(phone, {})
        status = str(record.get("status") or "pending")
        if status not in {"pending", "processing", "handled"}:
            status = "pending"
        candidate["followupStatus"] = status
        candidate["noteText"] = str(record.get("noteText") or "")
        candidate["contactName"] = str(record.get("contactName") or "")
        candidate["phoneNoteText"] = str(record.get("phoneNoteText") or "")
        candidate["stateUpdatedAt"] = float(record.get("updatedAt") or 0)
        if status == "handled":
            handled_count += 1
        elif status == "processing":
            processing_count += 1
        else:
            pending_count += 1
    summary = result.setdefault("summary", {})
    summary["pendingFollowupCount"] = pending_count
    summary["processingFollowupCount"] = processing_count
    summary["handledFollowupCount"] = handled_count
    complaints = result.get("complaints", {})
    complaint_records = complaints.get("phones", []) if isinstance(complaints, dict) else []
    if isinstance(complaints, dict) and isinstance(complaint_records, list):
        known_person_count = 0
        pending_complaint_count = 0
        processing_complaint_count = 0
        handled_complaint_count = 0
        for complaint_record in complaint_records:
            if not isinstance(complaint_record, dict):
                continue
            phone = normalize_phone(complaint_record.get("phone"))
            record = state_records.get(phone, {})
            status = str(record.get("status") or "pending")
            if status not in {"pending", "processing", "handled"}:
                status = "pending"
            contact_name = str(record.get("contactName") or "")
            complaint_record["followupStatus"] = status
            complaint_record["noteText"] = str(record.get("noteText") or "")
            complaint_record["contactName"] = contact_name
            complaint_record["personName"] = contact_name or "未标注"
            complaint_record["phoneNoteText"] = str(record.get("phoneNoteText") or "")
            complaint_record["stateUpdatedAt"] = float(record.get("updatedAt") or 0)
            if contact_name:
                known_person_count += 1
            if status == "handled":
                handled_complaint_count += 1
            elif status == "processing":
                processing_complaint_count += 1
            else:
                pending_complaint_count += 1
        complaint_summary = complaints.setdefault("summary", {})
        complaint_summary["knownPersonCount"] = known_person_count
        complaint_summary["pendingComplaintCount"] = pending_complaint_count
        complaint_summary["processingComplaintCount"] = processing_complaint_count
        complaint_summary["handledComplaintCount"] = handled_complaint_count
    return result


def load_download_config() -> dict[str, Any]:
    """读取自动下载配置，缺省值集中在这里，避免前后端各写一套。"""
    default_config = {
        "baseUrl": "http://127.0.0.1:9001/",
        "companyCode": "",
        "account": "",
        "password": "",
        "days": 30,
        "downloadDir": str(DOWNLOAD_OUTPUT_DIR),
        "profileDir": str(DOWNLOAD_BROWSER_PROFILE_DIR),
        "debugPort": 9876,
    }
    if not DOWNLOAD_CONFIG_FILE.exists():
        return default_config
    loaded = json.loads(DOWNLOAD_CONFIG_FILE.read_text(encoding="utf-8"))
    return {**default_config, **loaded}


def save_download_config(payload: dict[str, Any]) -> dict[str, Any]:
    """保存自动下载配置，账号密码只保存在当前项目本地文件。"""
    current = load_download_config()
    next_config = {
        **current,
        "baseUrl": str(payload.get("baseUrl") or current["baseUrl"]).strip(),
        "companyCode": str(payload.get("companyCode") or "").strip(),
        "account": str(payload.get("account") or "").strip(),
        "password": str(payload.get("password")) if payload.get("password") else str(current.get("password") or ""),
        "days": max(1, min(365, int(payload.get("days") or current["days"]))),
        "downloadDir": str(DOWNLOAD_OUTPUT_DIR),
        "profileDir": str(DOWNLOAD_BROWSER_PROFILE_DIR),
        "debugPort": int(payload.get("debugPort") or current["debugPort"]),
    }
    DOWNLOAD_CONFIG_FILE.write_text(json.dumps(next_config, ensure_ascii=False, indent=2), encoding="utf-8")
    write_log("保存配置", "自动下载", f"天数={next_config['days']} 地址={next_config['baseUrl']}")
    return next_config
