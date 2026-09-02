#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_RANDOM_COUNTDOWN_SECONDS = 30
DEFAULT_TOTAL_TASK_COUNT = 500


@dataclass(frozen=True)
class LiveRoomConfig:
    id: str
    name: str
    url: str


@dataclass(frozen=True)
class AccountProfileConfig:
    id: str
    name: str
    profile_key: str


@dataclass(frozen=True)
class CommentConfig:
    id: str
    text: str
    enabled: bool = True
    sent_count: int = 0


@dataclass(frozen=True)
class ScheduleConfig:
    random_countdown_seconds: int


@dataclass(frozen=True)
class BrowserConfig:
    executable_path: str = ""


@dataclass(frozen=True)
class WorkTaskConfig:
    total_count: int = DEFAULT_TOTAL_TASK_COUNT


@dataclass(frozen=True)
class AppConfig:
    active_room_id: str
    live_rooms: tuple[LiveRoomConfig, ...]
    active_account_id: str
    account_profiles: tuple[AccountProfileConfig, ...]
    comments: tuple[CommentConfig, ...]
    schedule: ScheduleConfig
    work_task: WorkTaskConfig
    browser: BrowserConfig


def _default_comments() -> tuple[CommentConfig, ...]:
    # 该函数用于沉淀默认评论库，内容来自客服表格并改写成直播观众购买问句。
    texts = [
        "家里老人慢阻肺，平时血氧90到93左右，主播建议看几升的制氧机？",
        "这款能不能24小时连续开？长时间用氧浓度会不会掉？",
        "3升和5升主要差在哪里？老人长期吸氧选哪个更稳？",
        "如果只是偶尔胸闷、日常保健吸氧，1升机够不够用？",
        "家里老人不会操作，这款按键和遥控方便吗？",
        "晚上睡觉开着声音大不大？会不会影响休息？",
        "这款需要加水吗？滤芯这些耗材一般多久换一次？",
        "家里已经有呼吸机了，这个制氧机能不能一起接着用？",
        "呼吸机搭配制氧机的话，3升够不够，还是直接看5升？",
        "家里电压有时候不太稳，用制氧机需要配稳压器吗？",
        "高原地区能用吗？海拔4000米左右氧浓度稳定吗？",
        "血氧低于90的话，是不是就要考虑5升以上的机型？",
        "肺气肿长期在家吸氧，主播更建议哪一款？",
        "术后恢复在家用，选3升还是5升比较合适？",
        "这款有雾化功能吗？老人咳嗽有痰的时候能一起用吗？",
        "制氧机功率大概多少？家里普通插座能直接用吗？",
        "有没有低氧报警、定时这些功能？老人自己用安全吗？",
        "氧浓度能显示吗？实际能不能保持90%以上？",
        "如果只是想给老人备用应急，是不是3升比1升更稳妥？",
        "售后保修怎么处理？老人不会用的话能不能教一下？",
    ]
    return tuple(CommentConfig(id=f"comment-{index + 1}", text=text, enabled=True) for index, text in enumerate(texts))


def default_config() -> AppConfig:
    # 该函数用于生成第一次运行的默认配置，确保新项目打开即可使用。
    live_rooms = (
        LiveRoomConfig(
            id="room-deda-official",
            name="DEDAKJ官方旗舰店",
            url="https://www.douyin.com/follow/live/333028521171?anchor_id=3933387414831904",
        ),
        LiveRoomConfig(
            id="room-deda-second",
            name="德达官方旗舰店",
            url="https://www.douyin.com/follow/live/630754001511?anchor_id=4019409679826455",
        ),
    )
    account_profiles = (
        AccountProfileConfig(id="account-default", name="默认账号", profile_key="default"),
    )
    return AppConfig(
        active_room_id=live_rooms[0].id,
        live_rooms=live_rooms,
        active_account_id=account_profiles[0].id,
        account_profiles=account_profiles,
        comments=_default_comments(),
        schedule=ScheduleConfig(random_countdown_seconds=DEFAULT_RANDOM_COUNTDOWN_SECONDS),
        work_task=WorkTaskConfig(total_count=DEFAULT_TOTAL_TASK_COUNT),
        browser=BrowserConfig(executable_path=""),
    )


def _slugify(value: str, *, fallback: str) -> str:
    # 该函数用于把前端传入的标识清洗成稳定目录名，避免不同账号资料互相污染。
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9_-]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-_")
    return text or fallback


def _as_int(raw_value: Any, *, field: str, min_value: int | None = None) -> int:
    # 该函数用于统一解析整数配置，避免空字符串污染运行逻辑。
    try:
        value = int(float(str(raw_value).strip()))
    except Exception as exc:
        raise RuntimeError(f"配置错误：{field} 必须是数字，当前值={raw_value!r}") from exc
    if min_value is not None and value < int(min_value):
        raise RuntimeError(f"配置错误：{field} 不能小于 {min_value}，当前值={value}")
    return value


def _load_live_rooms(raw_value: Any) -> tuple[LiveRoomConfig, ...]:
    # 该函数用于读取直播间配置，并去掉空链接和重复 ID。
    if not isinstance(raw_value, list):
        raise RuntimeError("配置错误：live_rooms 必须是数组")
    out: list[LiveRoomConfig] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(raw_value):
        if not isinstance(item, dict):
            raise RuntimeError(f"配置错误：live_rooms[{index}] 必须是对象")
        name = str(item.get("name") or f"直播间{index + 1}").strip()
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        if not url.startswith(("http://", "https://")):
            raise RuntimeError(f"配置错误：直播链接必须以 http:// 或 https:// 开头：{url}")
        room_id = _slugify(str(item.get("id") or name or f"room-{index + 1}"), fallback=f"room-{index + 1}")
        if room_id in seen_ids:
            room_id = f"{room_id}-{index + 1}"
        seen_ids.add(room_id)
        out.append(LiveRoomConfig(id=room_id, name=name, url=url))
    if not out:
        raise RuntimeError("配置错误：至少需要保留一个直播间链接")
    return tuple(out)


def _load_account_profiles(raw_value: Any) -> tuple[AccountProfileConfig, ...]:
    # 该函数用于读取账号档案，账号只隔离浏览器资料目录，不保存明文密码。
    if not isinstance(raw_value, list):
        raise RuntimeError("配置错误：account_profiles 必须是数组")
    out: list[AccountProfileConfig] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(raw_value):
        if not isinstance(item, dict):
            raise RuntimeError(f"配置错误：account_profiles[{index}] 必须是对象")
        name = str(item.get("name") or f"账号{index + 1}").strip()
        account_id = _slugify(str(item.get("id") or name or f"account-{index + 1}"), fallback=f"account-{index + 1}")
        if account_id in seen_ids:
            account_id = f"{account_id}-{index + 1}"
        seen_ids.add(account_id)
        profile_key = _slugify(str(item.get("profile_key") or account_id), fallback=account_id)
        out.append(AccountProfileConfig(id=account_id, name=name, profile_key=profile_key))
    if not out:
        out.append(AccountProfileConfig(id="account-default", name="默认账号", profile_key="default"))
    return tuple(out)


def _load_comments(raw_value: Any) -> tuple[CommentConfig, ...]:
    # 该函数用于读取评论库，保证至少有一条启用评论可发送。
    if not isinstance(raw_value, list):
        raise RuntimeError("配置错误：comments 必须是数组")
    out: list[CommentConfig] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(raw_value):
        if isinstance(item, str):
            item = {"text": item, "enabled": True}
        if not isinstance(item, dict):
            raise RuntimeError(f"配置错误：comments[{index}] 必须是对象或字符串")
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        comment_id = _slugify(str(item.get("id") or f"comment-{index + 1}"), fallback=f"comment-{index + 1}")
        if comment_id in seen_ids:
            comment_id = f"{comment_id}-{index + 1}"
        seen_ids.add(comment_id)
        sent_count = _as_int(item.get("sent_count", 0), field=f"comments[{index}].sent_count", min_value=0)
        out.append(CommentConfig(id=comment_id, text=text, enabled=bool(item.get("enabled", True)), sent_count=sent_count))
    if not out:
        out = list(_default_comments())
    if not any(comment.enabled for comment in out):
        raise RuntimeError("配置错误：评论库至少需要启用一条评论")
    return tuple(out)


def _load_schedule(raw_value: Any) -> ScheduleConfig:
    # 该函数用于读取评论库自动发送前的确认倒计时，旧配置缺字段时使用默认 30 秒。
    raw = raw_value if isinstance(raw_value, dict) else {}
    random_countdown = _as_int(raw.get("random_countdown_seconds", DEFAULT_RANDOM_COUNTDOWN_SECONDS), field="评论库自动倒计时", min_value=1)
    return ScheduleConfig(random_countdown_seconds=random_countdown)


def _load_work_task(raw_value: Any) -> WorkTaskConfig:
    # 该函数用于读取本次运行的总任务目标，旧配置缺字段时默认 500 次。
    raw = raw_value if isinstance(raw_value, dict) else {}
    total_count = _as_int(raw.get("total_count", DEFAULT_TOTAL_TASK_COUNT), field="总工作任务", min_value=1)
    return WorkTaskConfig(total_count=total_count)


def _pick_existing_id(selected_id: str, available_ids: tuple[str, ...]) -> str:
    # 该函数用于保证当前选择始终落在真实存在的列表里。
    value = str(selected_id or "").strip()
    if value in available_ids:
        return value
    return available_ids[0]


def _load_config_from_dict(raw: dict[str, Any]) -> AppConfig:
    # 该函数用于把 JSON 对象转换成强类型配置，运行期只接收可信对象。
    live_rooms = _load_live_rooms(raw.get("live_rooms"))
    account_profiles = _load_account_profiles(raw.get("account_profiles", []))
    comments = _load_comments(raw.get("comments", []))
    schedule = _load_schedule(raw.get("schedule", {}))
    work_task = _load_work_task(raw.get("work_task", {}))
    browser_raw = raw.get("browser") if isinstance(raw.get("browser"), dict) else {}
    return AppConfig(
        active_room_id=_pick_existing_id(str(raw.get("active_room_id") or ""), tuple(room.id for room in live_rooms)),
        live_rooms=live_rooms,
        active_account_id=_pick_existing_id(str(raw.get("active_account_id") or ""), tuple(account.id for account in account_profiles)),
        account_profiles=account_profiles,
        comments=comments,
        schedule=schedule,
        work_task=work_task,
        browser=BrowserConfig(executable_path=str(browser_raw.get("executable_path") or "").strip()),
    )


def config_to_dict(config: AppConfig) -> dict[str, Any]:
    # 该函数用于把强类型配置写回 JSON，保持 UTF-8 和可读缩进。
    return {
        "_comment": "账号档案只用于隔离浏览器资料目录，不保存抖音账号密码；评论库按发送次数最少优先选择，发送前会按配置倒计时确认；总工作任务用于限制本次运行成功发送次数。",
        "active_room_id": config.active_room_id,
        "live_rooms": [{"id": item.id, "name": item.name, "url": item.url} for item in config.live_rooms],
        "active_account_id": config.active_account_id,
        "account_profiles": [{"id": item.id, "name": item.name, "profile_key": item.profile_key} for item in config.account_profiles],
        "comments": [{"id": item.id, "text": item.text, "enabled": item.enabled, "sent_count": item.sent_count} for item in config.comments],
        "schedule": {
            "random_countdown_seconds": config.schedule.random_countdown_seconds,
        },
        "work_task": {
            "total_count": config.work_task.total_count,
        },
        "browser": {"executable_path": config.browser.executable_path},
    }


def load_config(path: str | Path) -> AppConfig:
    # 该函数用于读取配置；配置不存在时自动生成默认配置，避免空项目无法启动。
    config_path = Path(path)
    if not config_path.exists():
        config = default_config()
        save_config(config_path, config)
        return config
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise RuntimeError(f"读取配置失败：{config_path}（{type(exc).__name__}: {exc}）") from exc
    if not isinstance(raw, dict):
        raise RuntimeError("配置错误：根节点必须是对象")
    return _load_config_from_dict(raw)


def save_config(path: str | Path, config: AppConfig) -> None:
    # 该函数用于保存配置，统一 UTF-8 编码和 JSON 格式。
    config_path = Path(path)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(config_to_dict(config), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def config_from_payload(payload: dict[str, Any]) -> AppConfig:
    # 该函数用于把网页保存请求转换成强类型配置，所有校验集中在这里。
    if not isinstance(payload, dict):
        raise RuntimeError("保存配置失败：请求体必须是对象")
    return _load_config_from_dict(
        {
            "active_room_id": payload.get("active_room_id"),
            "live_rooms": payload.get("live_rooms"),
            "active_account_id": payload.get("active_account_id"),
            "account_profiles": payload.get("account_profiles"),
            "comments": payload.get("comments"),
            "schedule": payload.get("schedule"),
            "work_task": payload.get("work_task"),
            "browser": payload.get("browser"),
        }
    )


def get_active_room(config: AppConfig) -> LiveRoomConfig:
    # 该函数用于读取当前直播间，调用前配置已保证 ID 有效。
    for room in config.live_rooms:
        if room.id == config.active_room_id:
            return room
    return config.live_rooms[0]


def get_active_account(config: AppConfig) -> AccountProfileConfig:
    # 该函数用于读取当前账号档案，调用前配置已保证 ID 有效。
    for account in config.account_profiles:
        if account.id == config.active_account_id:
            return account
    return config.account_profiles[0]


__all__ = [
    "AccountProfileConfig",
    "AppConfig",
    "BrowserConfig",
    "CommentConfig",
    "DEFAULT_RANDOM_COUNTDOWN_SECONDS",
    "DEFAULT_TOTAL_TASK_COUNT",
    "LiveRoomConfig",
    "ScheduleConfig",
    "WorkTaskConfig",
    "config_from_payload",
    "config_to_dict",
    "default_config",
    "get_active_account",
    "get_active_room",
    "load_config",
    "save_config",
]
