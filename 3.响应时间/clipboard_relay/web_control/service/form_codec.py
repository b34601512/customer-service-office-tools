#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from ...config import BuyerUrlEntry, CredentialConfig, CredentialEntry

def _split_keywords(text: str) -> tuple[str, ...]:
    # 该函数用于把网页表单里的关键字拆成列表。
    raw = str(text or "").replace("，", ",").replace("\n", ",")
    values = tuple(item.strip() for item in raw.split(",") if item.strip())
    if not values:
        raise RuntimeError("窗口标题关键字不能为空")
    return values


def _parse_ratio(text: str) -> tuple[float, float]:
    # 该函数用于解析比例型表单，例如 0.5,0.86。
    parts = [item.strip() for item in str(text or "").replace("，", ",").split(",") if item.strip()]
    if len(parts) != 2:
        raise RuntimeError("输入框位置比例必须是两个数字，例如 0.5,0.86")
    x, y = float(parts[0]), float(parts[1])
    if not (0 <= x <= 1 and 0 <= y <= 1):
        raise RuntimeError("输入框位置比例必须在 0 到 1 之间")
    return x, y


def _parse_range(text: str, *, field: str) -> tuple[float, float]:
    # 该函数用于解析范围型表单，例如 3,5。
    parts = [item.strip() for item in str(text or "").replace("，", ",").split(",") if item.strip()]
    if len(parts) != 2:
        raise RuntimeError(f"{field}必须是两个数字，例如 3,5")
    start = float(parts[0])
    end = float(parts[1])
    if start < 0 or end < 0 or end < start:
        raise RuntimeError(f"{field}必须满足 0 <= 最小值 <= 最大值")
    return start, end


def _parse_pair(text: str, *, field: str) -> tuple[float, float]:
    # 该函数用于解析成对时间配置，例如 60,30。
    parts = [item.strip() for item in str(text or "").replace("，", ",").split(",") if item.strip()]
    if len(parts) != 2:
        raise RuntimeError(f"{field}必须是两个数字，例如 60,30")
    first = float(parts[0])
    second = float(parts[1])
    if first < 0 or second < 0:
        raise RuntimeError(f"{field}不能小于 0")
    return first, second


def _parse_url_lines(text: str, *, selected_url: str) -> tuple[str, ...]:
    # 该函数用于解析买家咨询网址库，每行一个链接，并把当前选择补进列表。
    urls: list[str] = []
    seen: set[str] = set()
    for item in str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        url = item.strip()
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    selected = str(selected_url or "").strip()
    if selected and selected not in seen:
        urls.insert(0, selected)
    if not urls:
        raise RuntimeError("买家咨询网址库不能为空，请至少保留一个链接")
    return tuple(urls)


def _parse_buyer_url_entries(raw_entries: Any, text: str, *, selected_url: str) -> tuple[BuyerUrlEntry, ...]:
    # 该函数用于解析买家咨询链接和备注；只填备注的店铺草稿也要保留。
    entries: list[BuyerUrlEntry] = []
    if isinstance(raw_entries, list):
        for index, item in enumerate(raw_entries):
            if isinstance(item, str):
                entries.append(BuyerUrlEntry(url=item, note=""))
                continue
            if isinstance(item, dict):
                entries.append(BuyerUrlEntry(url=str(item.get("url") or "").strip(), note=str(item.get("note") or "").strip()))
                continue
            raise RuntimeError(f"买家咨询链接条目[{index}]必须是对象")
    else:
        entries.extend(BuyerUrlEntry(url=url, note="") for url in _parse_url_lines(text, selected_url=selected_url))

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

    selected = str(selected_url or "").strip()
    if selected and selected not in seen:
        out.insert(0, BuyerUrlEntry(url=selected, note=""))
    if not out:
        raise RuntimeError("买家咨询店铺不能为空，请至少填写一个店铺名称或店铺链接")
    return tuple(out)


def _format_number(value: float | int) -> str:
    # 该函数用于把整数型浮点展示成整数，避免网页表单默认值全是小数点。
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return str(value)


def _format_numbers(values: list[float] | tuple[float, ...]) -> str:
    # 该函数用于统一展示多值配置。
    return ",".join(_format_number(item) for item in values)


def _format_buyer_url_entries(entries: tuple[BuyerUrlEntry, ...], urls: tuple[str, ...]) -> list[dict[str, str]]:
    # 该函数用于给网页端输出结构化链接条目；旧配置没有备注时自动补空备注。
    if entries:
        return [{"url": entry.url, "note": entry.note} for entry in entries]
    return [{"url": url, "note": ""} for url in urls]


def _credential_identity(credential: CredentialConfig | CredentialEntry) -> str:
    # 该函数用于判断账号条目是否重复，账号和密码同时一致才视为同一个档案。
    return f"{str(credential.username or '').strip()}\n{str(credential.password or '')}"


def _parse_credential_entries(raw_entries: Any, *, selected: CredentialConfig, fallback_entries: tuple[CredentialEntry, ...], field: str) -> tuple[CredentialEntry, ...]:
    # 该函数用于解析账号管理弹窗的条目；只填备注的店铺草稿也要保留。
    entries: list[CredentialEntry] = []
    if isinstance(raw_entries, list):
        for index, item in enumerate(raw_entries):
            if not isinstance(item, dict):
                raise RuntimeError(f"{field}账号条目[{index}]必须是对象")
            entries.append(
                CredentialEntry(
                    username=str(item.get("username") or "").strip(),
                    password=str(item.get("password") or ""),
                    note=str(item.get("note") or "").strip(),
                )
            )
    else:
        entries.extend(fallback_entries)

    out: list[CredentialEntry] = []
    indexes: dict[str, int] = {}
    seen: set[str] = set()
    for entry in entries:
        username = str(entry.username or "").strip()
        password = str(entry.password or "")
        note = str(entry.note or "").strip()
        if not username and not password and not note:
            continue
        if not username and not password:
            out.append(CredentialEntry(username="", password="", note=note))
            continue
        identity = _credential_identity(CredentialEntry(username=username, password=password, note=note))
        if identity in seen:
            existing_index = indexes[identity]
            if note and not out[existing_index].note:
                out[existing_index] = CredentialEntry(username=username, password=password, note=note)
            continue
        seen.add(identity)
        indexes[identity] = len(out)
        out.append(CredentialEntry(username=username, password=password, note=note))

    selected_identity = _credential_identity(selected)
    if selected_identity.strip() and selected_identity not in seen:
        out.insert(0, CredentialEntry(username=selected.username, password=selected.password, note=""))
    return tuple(out)


def _format_credential_entries(entries: tuple[CredentialEntry, ...], selected: CredentialConfig) -> list[dict[str, str]]:
    # 该函数用于给网页端输出账号档案，并确保当前账号能在管理弹窗里看到。
    out = [{"username": entry.username, "password": entry.password, "note": entry.note} for entry in entries]
    selected_identity = _credential_identity(selected)
    has_selected = any(_credential_identity(CredentialEntry(**entry)) == selected_identity for entry in out)
    if selected_identity.strip() and not has_selected:
        out.insert(0, {"username": selected.username, "password": selected.password, "note": ""})
    return out

__all__ = ["_split_keywords", "_parse_ratio", "_parse_range", "_parse_pair", "_parse_url_lines", "_parse_buyer_url_entries", "_format_number", "_format_numbers", "_format_buyer_url_entries", "_credential_identity", "_parse_credential_entries", "_format_credential_entries"]
