#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

_USAGE_HISTORY_FILE = "usage_history.json"


def _format_date_text(raw_date: str) -> str:
    # 该函数用于把机器可读日期转成首页展示的中文年月日，同时校验历史文件是否可信。
    text = str(raw_date or "").strip()
    if not text:
        return "暂无记录"
    try:
        parsed = date.fromisoformat(text)
    except Exception as exc:
        raise RuntimeError(f"使用记录日期格式错误：{text}") from exc
    return parsed.strftime("%Y年%m月%d日")


def _read_history(path: Path) -> dict[str, Any]:
    # 该函数用于读取上次使用记录；文件不存在代表第一次启动，不算异常。
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        # 断电/强杀可能留下截断的 JSON；本文件只服务首页展示，损坏时视同首次使用，不阻断启动（#607）。
        return {}
    if not isinstance(raw, dict):
        # 根节点结构错乱同样视同首次使用；日期字段的格式校验仍保持严格（见 _format_date_text）。
        return {}
    return raw


def record_software_open(root_dir: str | Path, *, today: date | None = None) -> dict[str, str]:
    # 该函数用于在软件打开时先返回旧日期，再把本次打开日期写入运行记录。
    app_root = Path(root_dir)
    runtime_dir = app_root / "runtime"
    history_path = runtime_dir / _USAGE_HISTORY_FILE
    history = _read_history(history_path)
    previous_used_date = str(history.get("last_used_date") or "").strip()
    previous_used_date_text = _format_date_text(previous_used_date)
    current_used_date = (today or date.today()).isoformat()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    history_path.write_text(
        json.dumps({"last_used_date": current_used_date}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "previousUsedDate": previous_used_date,
        "previousUsedDateText": previous_used_date_text,
        "currentUsedDate": current_used_date,
        "currentUsedDateText": _format_date_text(current_used_date),
    }


__all__ = ["record_software_open"]
