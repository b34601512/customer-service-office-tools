#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest
from unittest.mock import patch

from refund_reminder.config import default_config
from refund_reminder.order_detector import ProblemOrder
from refund_reminder.system_notifier import SystemNotificationPayload, _send_windows_tray_notification, build_order_notification


class SystemNotifierTest(unittest.TestCase):
    def test_build_order_notification_limits_visible_orders(self) -> None:
        config = default_config()
        orders = tuple(
            ProblemOrder(
                row_index=index,
                identity=f"平台单号:P{index}",
                summary=f"平台单号:P{index}",
                key=f"key-{index}",
                row={"平台单号": f"P{index}"},
            )
            for index in range(1, 10)
        )

        payload = build_order_notification(config, orders)

        self.assertEqual(payload.title, "退款自动提醒")
        self.assertIn("发现 9 个新增未处理订单。", payload.body)
        self.assertIn("1. 平台单号:P1", payload.body)
        self.assertIn("8. 平台单号:P8", payload.body)
        self.assertIn("另有 1 个未展示", payload.body)
        self.assertNotIn("9. 平台单号:P9", payload.body)

    def test_windows_notification_uses_plain_script_and_environment_payload(self) -> None:
        payload = SystemNotificationPayload(title="退款提醒'测试", body="订单一\n订单二")

        with patch("refund_reminder.system_notifier.subprocess.Popen") as popen:
            _send_windows_tray_notification(payload)

        command = popen.call_args.args[0]
        child_environment = popen.call_args.kwargs["env"]
        self.assertIn("-Command", command)
        self.assertNotIn("-EncodedCommand", command)
        self.assertEqual(child_environment["REFUND_REMINDER_NOTIFY_TITLE"], payload.title)
        self.assertEqual(child_environment["REFUND_REMINDER_NOTIFY_BODY"], payload.body)
        self.assertNotIn(payload.title, " ".join(command))


if __name__ == "__main__":
    unittest.main()
