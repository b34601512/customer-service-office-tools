#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from typing import Sequence

from .config import AppConfig
from .logger import log
from .order_detector import ProblemOrder

_MODULE = "refund_reminder.system_notifier"


@dataclass(frozen=True)
class SystemNotificationPayload:
    title: str
    body: str


def build_order_notification(config: AppConfig, orders: Sequence[ProblemOrder]) -> SystemNotificationPayload:
    # 该函数只负责把新增订单转换成系统通知标题和正文。
    max_items = max(1, int(config.notification.max_notification_orders))
    visible_orders = tuple(orders[:max_items])
    hidden_count = max(0, len(orders) - len(visible_orders))
    title = "退款自动提醒"
    lines = [f"发现 {len(orders)} 个新增未处理订单。"]
    lines.extend(f"{index}. {order.summary}" for index, order in enumerate(visible_orders, start=1))
    if hidden_count:
        lines.append(f"另有 {hidden_count} 个未展示，请打开后台查看。")
    return SystemNotificationPayload(title=title, body="\n".join(lines))


def send_order_system_notification(config: AppConfig, orders: Sequence[ProblemOrder]) -> SystemNotificationPayload:
    # 该函数负责发送新增订单系统通知，调用方不需要知道具体操作系统实现。
    if not orders:
        raise RuntimeError("系统通知失败：新增订单不能为空")
    payload = build_order_notification(config, orders)
    send_system_notification(payload)
    log("SystemNotify", "已发送系统通知", _MODULE, "send_order_system_notification", count=len(orders))
    return payload


def send_system_notification(payload: SystemNotificationPayload) -> None:
    # 该函数按当前操作系统选择通知实现，目前本工具客服包只支持 Windows。
    if sys.platform != "win32":
        raise RuntimeError(f"系统通知失败：当前仅支持 Windows，当前平台={sys.platform}")
    _send_windows_tray_notification(payload)


def _send_windows_tray_notification(payload: SystemNotificationPayload) -> None:
    # 该函数通过 Windows 托盘气泡通知发提醒，避免依赖浏览器页面是否可见。
    script = _build_windows_notification_script()
    child_environment = dict(os.environ)
    child_environment["REFUND_REMINDER_NOTIFY_TITLE"] = str(payload.title)
    child_environment["REFUND_REMINDER_NOTIFY_BODY"] = str(payload.body)
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-Command", script],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=child_environment,
            creationflags=creationflags,
            close_fds=True,
        )
    except Exception as exc:
        raise RuntimeError(f"系统通知失败：无法启动 PowerShell 通知进程（{type(exc).__name__}: {exc}）") from exc


def _build_windows_notification_script() -> str:
    # 该函数生成固定明文脚本；动态文字从子进程环境变量读取，不拼接进命令。
    return """
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$title = [Environment]::GetEnvironmentVariable('REFUND_REMINDER_NOTIFY_TITLE', 'Process')
$body = [Environment]::GetEnvironmentVariable('REFUND_REMINDER_NOTIFY_BODY', 'Process')
$notify = New-Object System.Windows.Forms.NotifyIcon
try {
  $notify.Icon = [System.Drawing.SystemIcons]::Warning
  $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
  $notify.BalloonTipTitle = $title
  $notify.BalloonTipText = $body
  $notify.Visible = $true
  $notify.ShowBalloonTip(10000)
  Start-Sleep -Seconds 12
} finally {
  $notify.Dispose()
}
""".strip()


__all__ = [
    "SystemNotificationPayload",
    "build_order_notification",
    "send_order_system_notification",
    "send_system_notification",
]
