#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from .models import BuyerUrlEntry


def load_jd_url_from_mapping(raw: dict[str, Any]) -> str:
    # 该函数用于从对象里读取单个长链接，兼容分段配置，避免 JSON 单行太长。
    parts = raw.get("jd_url_parts")
    if parts is None:
        parts = raw.get("url_parts")
    if parts is None:
        return str(raw.get("jd_url") or raw.get("url") or "").strip()
    if not isinstance(parts, list):
        raise RuntimeError("配置错误：买家咨询网址分段必须是字符串列表")
    joined = "".join(str(item or "") for item in parts).strip()
    if joined:
        return joined
    return str(raw.get("jd_url") or raw.get("url") or "").strip()


def load_jd_url_note_from_mapping(raw: dict[str, Any]) -> str:
    # 该函数用于读取买家咨询链接备注，兼容用户习惯里的 note/remark/name 三种字段名。
    return str(raw.get("note") or raw.get("remark") or raw.get("name") or "").strip()


def dedupe_url_entries(entries: list[BuyerUrlEntry]) -> tuple[BuyerUrlEntry, ...]:
    # 该函数用于清理买家咨询链接条目；有备注但未填 URL 的草稿也必须保留。
    out: list[BuyerUrlEntry] = []
    indexes: dict[str, int] = {}
    seen: set[str] = set()
    for entry in entries:
        url = str(entry.url or "").strip()
        note = str(entry.note or "").strip()
        if not url and not note:
            continue
        if not url:
            out.append(BuyerUrlEntry(url="", note=note))
            continue
        if url in seen:
            existing_index = indexes[url]
            if note and not out[existing_index].note:
                out[existing_index] = BuyerUrlEntry(url=url, note=note)
            continue
        seen.add(url)
        indexes[url] = len(out)
        out.append(BuyerUrlEntry(url=url, note=note))
    return tuple(out)


def load_jd_url_entries(raw: dict[str, Any]) -> tuple[BuyerUrlEntry, ...]:
    # 该函数用于读取买家咨询链接和备注，旧版单链接配置会自动迁移成空备注条目。
    entries: list[BuyerUrlEntry] = []
    current = load_jd_url_from_mapping(raw)
    if current:
        entries.append(BuyerUrlEntry(url=current, note=load_jd_url_note_from_mapping(raw)))
    raw_urls = raw.get("jd_urls")
    if raw_urls is None:
        return dedupe_url_entries(entries)
    if not isinstance(raw_urls, list):
        raise RuntimeError("配置错误：jd_urls 必须是数组")
    for index, item in enumerate(raw_urls):
        if isinstance(item, str):
            entries.append(BuyerUrlEntry(url=item, note=""))
            continue
        if isinstance(item, dict):
            entries.append(BuyerUrlEntry(url=load_jd_url_from_mapping(item), note=load_jd_url_note_from_mapping(item)))
            continue
        raise RuntimeError(f"配置错误：jd_urls[{index}] 必须是字符串或对象")
    return dedupe_url_entries(entries)


def url_entries_to_urls(entries: tuple[BuyerUrlEntry, ...]) -> tuple[str, ...]:
    # 该函数用于维持旧字段 jd_urls 的只读兼容视图，核心流程仍按 URL 列表工作。
    return tuple(entry.url for entry in entries if entry.url)


def load_current_jd_url(raw: dict[str, Any], urls: tuple[str, ...]) -> str:
    # 该函数用于确定当前要打开的买家咨询网址；优先旧字段，缺省时使用网址库第一项。
    current = load_jd_url_from_mapping(raw)
    if current:
        return current
    return urls[0] if urls else ""


def chunk_text(text: str, *, chunk_size: int = 96) -> list[str]:
    # 该函数用于把长 URL 切成 JSON 友好的短片段，避免单行过长。
    s = str(text or "")
    size = max(16, int(chunk_size))
    return [s[index : index + size] for index in range(0, len(s), size)] or [""]


def config_url_entries(config_jd_urls: tuple[str, ...], config_jd_url_entries: tuple[BuyerUrlEntry, ...]) -> tuple[BuyerUrlEntry, ...]:
    # 该函数用于保存配置时补齐旧代码构造的 AppConfig，避免 jd_urls 和备注条目分叉。
    if config_jd_url_entries:
        return config_jd_url_entries
    return tuple(BuyerUrlEntry(url=url, note="") for url in config_jd_urls)

