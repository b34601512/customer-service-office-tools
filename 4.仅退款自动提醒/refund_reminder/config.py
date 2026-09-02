#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class LoginConfig:
    erp_url: str
    browser_start_timeout_sec: float
    page_load_timeout_sec: float
    login_wait_timeout_sec: float
    order_page_wait_timeout_sec: float
    poll_interval_sec: float
    browser_executable: str


@dataclass(frozen=True)
class MonitorConfig:
    interval_minutes: int
    auto_start_monitor: bool


@dataclass(frozen=True)
class DetectionConfig:
    identity_column_names: tuple[str, ...]
    required_page_texts: tuple[str, ...]


@dataclass(frozen=True)
class NotificationConfig:
    max_notification_orders: int
    payment_time_range_days: int


@dataclass(frozen=True)
class AppConfig:
    login: LoginConfig
    monitor: MonitorConfig
    detection: DetectionConfig
    notification: NotificationConfig


def _as_float(raw: Any, *, field: str, min_value: float | None = None) -> float:
    # 该函数用于把配置数字统一收口，避免主流程拿到脏字符串。
    try:
        value = float(raw)
    except Exception as exc:
        raise RuntimeError(f"配置错误：{field} 必须是数字，当前值={raw!r}") from exc
    if min_value is not None and value < float(min_value):
        raise RuntimeError(f"配置错误：{field} 不能小于 {min_value}，当前值={value}")
    return value


def _as_int(raw: Any, *, field: str, min_value: int | None = None) -> int:
    # 该函数用于把配置整数统一收口，避免间隔和数量进入异常状态。
    try:
        value = int(raw)
    except Exception as exc:
        raise RuntimeError(f"配置错误：{field} 必须是整数，当前值={raw!r}") from exc
    if min_value is not None and value < int(min_value):
        raise RuntimeError(f"配置错误：{field} 不能小于 {min_value}，当前值={value}")
    return value


def _as_bool(raw: Any, *, field: str) -> bool:
    # 该函数用于严格解析布尔值，避免字符串 false 被 Python 当成真值。
    if isinstance(raw, bool):
        return bool(raw)
    if isinstance(raw, str):
        text = raw.strip().lower()
        if text in {"true", "1", "yes", "on", "是"}:
            return True
        if text in {"false", "0", "no", "off", "否"}:
            return False
    raise RuntimeError(f"配置错误：{field} 必须是布尔值，当前值={raw!r}")


def _as_text_tuple(raw: Any, *, field: str) -> tuple[str, ...]:
    # 该函数用于把列名配置清洗成去重列表，避免空列名误判。
    if isinstance(raw, str):
        raw = raw.replace("，", ",").split(",")
    if not isinstance(raw, list):
        raise RuntimeError(f"配置错误：{field} 必须是字符串列表")
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    if not out:
        raise RuntimeError(f"配置错误：{field} 至少需要一个有效值")
    return tuple(out)


def default_config() -> AppConfig:
    # 该函数用于提供首次启动可直接运行的最小配置。
    return AppConfig(
        login=LoginConfig(
            erp_url="https://v2.guanyierp.com/index",
            browser_start_timeout_sec=120,
            page_load_timeout_sec=90,
            login_wait_timeout_sec=600,
            order_page_wait_timeout_sec=180,
            poll_interval_sec=1,
            browser_executable="",
        ),
        monitor=MonitorConfig(
            interval_minutes=5,
            auto_start_monitor=False,
        ),
        detection=DetectionConfig(
            identity_column_names=("平台单号", "订单编号", "店铺", "会员名称"),
            required_page_texts=("订单查询", "退款", "作废"),
        ),
        notification=NotificationConfig(max_notification_orders=8, payment_time_range_days=1),
    )


def _load_login(raw: Any) -> LoginConfig:
    # 该函数用于读取登录和页面等待配置。
    default = default_config().login
    data = raw if isinstance(raw, dict) else {}
    return LoginConfig(
        erp_url=str(data.get("erp_url") or default.erp_url).strip(),
        browser_start_timeout_sec=_as_float(data.get("browser_start_timeout_sec", default.browser_start_timeout_sec), field="login.browser_start_timeout_sec", min_value=10),
        page_load_timeout_sec=_as_float(data.get("page_load_timeout_sec", default.page_load_timeout_sec), field="login.page_load_timeout_sec", min_value=10),
        login_wait_timeout_sec=_as_float(data.get("login_wait_timeout_sec", default.login_wait_timeout_sec), field="login.login_wait_timeout_sec", min_value=1),
        order_page_wait_timeout_sec=_as_float(data.get("order_page_wait_timeout_sec", default.order_page_wait_timeout_sec), field="login.order_page_wait_timeout_sec", min_value=1),
        poll_interval_sec=_as_float(data.get("poll_interval_sec", default.poll_interval_sec), field="login.poll_interval_sec", min_value=0.2),
        browser_executable=str(data.get("browser_executable") or "").strip(),
    )


def _load_monitor(raw: Any) -> MonitorConfig:
    # 该函数用于读取监控节奏配置，监控间隔强制 5 分钟起步。
    default = default_config().monitor
    data = raw if isinstance(raw, dict) else {}
    return MonitorConfig(
        interval_minutes=_as_int(data.get("interval_minutes", default.interval_minutes), field="monitor.interval_minutes", min_value=5),
        auto_start_monitor=_as_bool(data.get("auto_start_monitor", default.auto_start_monitor), field="monitor.auto_start_monitor"),
    )


def _load_detection(raw: Any) -> DetectionConfig:
    # 该函数用于读取导出表判定配置，支付时间范围由通知配置单独控制。
    default = default_config().detection
    data = raw if isinstance(raw, dict) else {}
    return DetectionConfig(
        identity_column_names=_as_text_tuple(data.get("identity_column_names", list(default.identity_column_names)), field="detection.identity_column_names"),
        required_page_texts=_as_text_tuple(data.get("required_page_texts", list(default.required_page_texts)), field="detection.required_page_texts"),
    )


def _load_notification(raw: Any) -> NotificationConfig:
    # 该函数用于读取系统通知配置，避免通知正文过长且只提醒指定付款范围。
    default = default_config().notification
    data = raw if isinstance(raw, dict) else {}
    legacy_value = data.get("max_popup_orders", default.max_notification_orders)
    return NotificationConfig(
        max_notification_orders=_as_int(data.get("max_notification_orders", legacy_value), field="notification.max_notification_orders", min_value=1),
        payment_time_range_days=_as_int(data.get("payment_time_range_days", default.payment_time_range_days), field="notification.payment_time_range_days", min_value=1),
    )


def load_config(path: str | Path) -> AppConfig:
    # 该函数用于读取并校验 config.json，让运行期拿到的配置已经可信。
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
    return AppConfig(
        login=_load_login(raw.get("login")),
        monitor=_load_monitor(raw.get("monitor")),
        detection=_load_detection(raw.get("detection")),
        notification=_load_notification(raw.get("notification")),
    )


def app_config_to_dict(config: AppConfig) -> dict[str, Any]:
    # 该函数用于把强类型配置写回 JSON，供后台保存配置。
    return {
        "_comment": "该配置由后台保存；监控间隔最小 5 分钟；通知付款范围默认今天。",
        "login": {
            "erp_url": config.login.erp_url,
            "browser_start_timeout_sec": config.login.browser_start_timeout_sec,
            "page_load_timeout_sec": config.login.page_load_timeout_sec,
            "login_wait_timeout_sec": config.login.login_wait_timeout_sec,
            "order_page_wait_timeout_sec": config.login.order_page_wait_timeout_sec,
            "poll_interval_sec": config.login.poll_interval_sec,
            "browser_executable": config.login.browser_executable,
        },
        "monitor": {
            "interval_minutes": config.monitor.interval_minutes,
            "auto_start_monitor": config.monitor.auto_start_monitor,
        },
        "detection": {
            "identity_column_names": list(config.detection.identity_column_names),
            "required_page_texts": list(config.detection.required_page_texts),
        },
        "notification": {
            "max_notification_orders": config.notification.max_notification_orders,
            "payment_time_range_days": config.notification.payment_time_range_days,
        },
    }


def save_config(path: str | Path, config: AppConfig) -> None:
    # 该函数用于统一 UTF-8 保存配置，避免中文列名乱码。
    config_path = Path(path)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(app_config_to_dict(config), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


__all__ = [
    "AppConfig",
    "DetectionConfig",
    "LoginConfig",
    "MonitorConfig",
    "NotificationConfig",
    "app_config_to_dict",
    "default_config",
    "load_config",
    "save_config",
]
