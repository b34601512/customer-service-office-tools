#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from .config import AppConfig, DetectionConfig, LoginConfig, MonitorConfig, NotificationConfig


def split_texts(text: str) -> tuple[str, ...]:
    # 该函数用于解析后台输入的逗号分隔配置。
    values = [item.strip() for item in str(text or "").replace("，", ",").split(",") if item.strip()]
    if not values:
        raise RuntimeError("配置项不能为空")
    return tuple(values)


def payload_bool(value: Any) -> bool:
    # 该函数用于解析网页表单布尔值，避免字符串 false 被误当成 True。
    if isinstance(value, bool):
        return bool(value)
    text = str(value or "").strip().lower()
    if text in {"true", "1", "yes", "on"}:
        return True
    if text in {"false", "0", "no", "off", ""}:
        return False
    raise RuntimeError(f"配置错误：布尔值不合法，当前值={value!r}")


def number_at_least(value: Any, *, field: str, minimum: float) -> float:
    # 该函数用于保存配置时同步做下限校验，避免坏配置落盘后下次启动才炸。
    try:
        number = float(str(value).strip())
    except Exception as exc:
        raise RuntimeError(f"配置错误：{field} 必须是数字，当前值={value!r}") from exc
    if number < minimum:
        raise RuntimeError(f"配置错误：{field} 不能小于 {minimum}，当前值={number}")
    return number


def format_exception(exc: BaseException) -> str:
    # 该函数用于把异常类型带进后台提示，避免只看到一段缺少上下文的错误文本。
    return f"{type(exc).__name__}: {exc}"


def config_to_form_state(config: AppConfig) -> dict[str, Any]:
    # 该函数用于把强类型配置转换成网页表单字段。
    return {
        "erp_url": config.login.erp_url,
        "interval_minutes": str(config.monitor.interval_minutes),
        "browser_start_timeout_sec": str(int(config.login.browser_start_timeout_sec)),
        "page_load_timeout_sec": str(int(config.login.page_load_timeout_sec)),
        "login_wait_timeout_sec": str(int(config.login.login_wait_timeout_sec)),
        "order_page_wait_timeout_sec": str(int(config.login.order_page_wait_timeout_sec)),
        "poll_interval_sec": str(config.login.poll_interval_sec),
        "auto_start_monitor": config.monitor.auto_start_monitor,
        "browser_executable": config.login.browser_executable,
        "identity_column_names": ",".join(config.detection.identity_column_names),
        "required_page_texts": ",".join(config.detection.required_page_texts),
        "max_notification_orders": str(config.notification.max_notification_orders),
        "payment_time_range_days": str(config.notification.payment_time_range_days),
    }


def build_config_from_form(current: AppConfig, payload: dict[str, Any]) -> AppConfig:
    # 该函数把网页表单 payload 转成强类型配置，所有危险值在这里直接抛中文异常。
    interval_minutes = int(number_at_least(payload.get("interval_minutes", ""), field="自动查询时间间隔分钟", minimum=5))
    return AppConfig(
        login=LoginConfig(
            erp_url=str(payload.get("erp_url") or current.login.erp_url).strip(),
            browser_start_timeout_sec=number_at_least(payload.get("browser_start_timeout_sec") or current.login.browser_start_timeout_sec, field="浏览器启动等待秒", minimum=10),
            page_load_timeout_sec=number_at_least(payload.get("page_load_timeout_sec") or current.login.page_load_timeout_sec, field="页面加载等待秒", minimum=10),
            login_wait_timeout_sec=number_at_least(payload.get("login_wait_timeout_sec") or current.login.login_wait_timeout_sec, field="登录等待秒", minimum=1),
            order_page_wait_timeout_sec=number_at_least(payload.get("order_page_wait_timeout_sec") or current.login.order_page_wait_timeout_sec, field="订单页等待秒", minimum=1),
            poll_interval_sec=number_at_least(payload.get("poll_interval_sec") or current.login.poll_interval_sec, field="状态轮询秒", minimum=0.2),
            browser_executable=str(payload.get("browser_executable") or "").strip(),
        ),
        monitor=MonitorConfig(
            interval_minutes=interval_minutes,
            auto_start_monitor=payload_bool(payload.get("auto_start_monitor")),
        ),
        detection=DetectionConfig(
            identity_column_names=split_texts(str(payload.get("identity_column_names") or "")),
            required_page_texts=split_texts(str(payload.get("required_page_texts") or "")),
        ),
        notification=NotificationConfig(
            max_notification_orders=int(number_at_least(payload.get("max_notification_orders") or current.notification.max_notification_orders, field="通知展示条数", minimum=1)),
            payment_time_range_days=int(number_at_least(payload.get("payment_time_range_days") or current.notification.payment_time_range_days, field="通知付款范围天数", minimum=1)),
        ),
    )


__all__ = ["build_config_from_form", "config_to_form_state", "format_exception"]
