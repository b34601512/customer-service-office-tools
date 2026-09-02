#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import base64
import io
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024
DEFAULT_SENTENCE_DELIMITERS = "。！？!?；;"
SUPPORTED_IMPORT_SUFFIXES = (".txt", ".docx")


def _decode_base64_content(value: str) -> bytes:
    # 该函数用于把前端上传的 base64 内容还原成文件字节，避免导入逻辑分散到接口层。
    text = str(value or "").strip()
    if not text:
        raise RuntimeError("导入失败：文件内容为空。")
    if "," in text and text.lower().startswith("data:"):
        text = text.split(",", 1)[1]
    try:
        content = base64.b64decode(text, validate=True)
    except Exception as exc:
        raise RuntimeError("导入失败：文件内容不是合法的 base64。") from exc
    if not content:
        raise RuntimeError("导入失败：文件内容为空。")
    if len(content) > MAX_IMPORT_FILE_BYTES:
        raise RuntimeError("导入失败：文件不能超过 8MB，请拆成多个小文件导入。")
    return content


def _decode_text_bytes(content: bytes) -> str:
    # 该函数用于兼容常见中文 TXT 编码，避免不是 UTF-8 时导入乱码。
    errors: list[str] = []
    for encoding in ("utf-8-sig", "gb18030", "utf-16", "utf-16le", "utf-16be"):
        try:
            text = content.decode(encoding)
        except UnicodeError as exc:
            errors.append(f"{encoding}:{exc}")
            continue
        if text and "\ufffd" not in text and text.count("\x00") <= max(1, len(text) // 20):
            return text
    raise RuntimeError(f"导入失败：无法识别 TXT 编码，请另存为 UTF-8 后重试。{'; '.join(errors[:2])}")


def _extract_docx_text(content: bytes) -> str:
    # 该函数用于读取 docx 正文段落，Word 导入只走这个稳定格式。
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            document_xml = archive.read("word/document.xml")
    except KeyError as exc:
        raise RuntimeError("导入失败：这个 docx 缺少正文内容。") from exc
    except zipfile.BadZipFile as exc:
        raise RuntimeError("导入失败：docx 文件损坏或格式不正确。") from exc

    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    try:
        root = ElementTree.fromstring(document_xml)
    except ElementTree.ParseError as exc:
        raise RuntimeError("导入失败：docx 正文 XML 损坏。") from exc
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        parts = [node.text or "" for node in paragraph.findall(".//w:t", namespace)]
        line = "".join(parts).strip()
        if line:
            paragraphs.append(line)
    return "\n".join(paragraphs)


def extract_import_text(file_name: str, content: bytes) -> str:
    # 该函数用于按文件类型提取纯文本，长期只保留 docx 和 txt 两条稳定路径。
    suffix = Path(str(file_name or "")).suffix.lower()
    if suffix == ".doc":
        raise RuntimeError("导入失败：旧版 doc 格式不稳定，请先在 Word 里另存为 docx 再导入。")
    if suffix not in SUPPORTED_IMPORT_SUFFIXES:
        raise RuntimeError("导入失败：当前只支持 txt 和 docx。")
    if suffix == ".docx":
        return _extract_docx_text(content)
    return _decode_text_bytes(content)


def _normalize_imported_comment(value: str) -> str:
    # 该函数用于清理单条评论的空白，避免导入后出现不可见换行和多余空格。
    return " ".join(str(value or "").replace("\u3000", " ").split()).strip()


def _split_by_lines(text: str) -> list[str]:
    # 该函数用于按一行一条评论切分，这是最稳定的默认规则。
    return [_normalize_imported_comment(line) for line in str(text or "").splitlines()]


def _split_by_delimiters(text: str, delimiters: str, *, keep_delimiter: bool) -> list[str]:
    # 该函数用于按分隔符切分文本，句号分号会保留，自定义分隔符会丢弃。
    clean_delimiters = "".join(dict.fromkeys(str(delimiters or "")))
    if not clean_delimiters:
        raise RuntimeError("导入失败：自定义分隔符不能为空。")
    delimiter_set = set(clean_delimiters)
    out: list[str] = []
    buffer: list[str] = []
    for char in str(text or ""):
        if char in "\r\n":
            if buffer:
                buffer.append(" ")
            continue
        if char in delimiter_set:
            if keep_delimiter:
                buffer.append(char)
            item = _normalize_imported_comment("".join(buffer))
            if item:
                out.append(item)
            buffer = []
            continue
        buffer.append(char)
    tail = _normalize_imported_comment("".join(buffer))
    if tail:
        out.append(tail)
    return out


def split_imported_comments(text: str, split_mode: str, custom_delimiters: str = "") -> list[str]:
    # 该函数用于把纯文本切成评论列表，支持按行、按常见标点和自定义分隔符。
    mode = str(split_mode or "line").strip().lower()
    if mode == "line":
        raw_items = _split_by_lines(text)
    elif mode == "sentence":
        raw_items = _split_by_delimiters(text, DEFAULT_SENTENCE_DELIMITERS, keep_delimiter=True)
    elif mode == "custom":
        raw_items = _split_by_delimiters(text, custom_delimiters, keep_delimiter=False)
    else:
        raise RuntimeError(f"导入失败：未知切分方式：{split_mode}")

    out: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        normalized = _normalize_imported_comment(item)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    if not out:
        raise RuntimeError("导入失败：没有识别到有效评论。")
    return out


def parse_comment_import_payload(payload: dict[str, Any]) -> dict[str, Any]:
    # 该函数用于把导入请求转换成前端可追加的评论列表。
    if not isinstance(payload, dict):
        raise RuntimeError("导入失败：请求体必须是对象。")
    file_name = str(payload.get("file_name") or "").strip()
    if not file_name:
        raise RuntimeError("导入失败：缺少文件名。")
    content = _decode_base64_content(str(payload.get("content_base64") or ""))
    text = extract_import_text(file_name, content)
    comments = split_imported_comments(
        text=text,
        split_mode=str(payload.get("split_mode") or "line"),
        custom_delimiters=str(payload.get("custom_delimiters") or ""),
    )
    return {
        "file_name": file_name,
        "count": len(comments),
        "comments": [{"text": item} for item in comments],
    }


__all__ = [
    "DEFAULT_SENTENCE_DELIMITERS",
    "SUPPORTED_IMPORT_SUFFIXES",
    "extract_import_text",
    "parse_comment_import_payload",
    "split_imported_comments",
]
