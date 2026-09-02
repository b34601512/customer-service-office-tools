#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest

from refund_reminder.order_detector import ProblemOrder
from refund_reminder.order_presenter import order_to_dict


class OrderPresenterTest(unittest.TestCase):
    def test_order_to_dict_exposes_business_context_fields(self) -> None:
        order = ProblemOrder(
            row_index=0,
            identity="平台单号:P001",
            summary="第1行｜平台单号:P001",
            key="key-p001",
            row={
                "平台单号": "P001",
                "店铺名称": "测试旗舰店",
                "订单来源": "拼多多",
                "配货状态": "全部配货",
                "发货状态": "全部发货",
                "审核": "审核成功",
                "支付日期": "2026-04-27 09:00:00",
                "退款": "√",
                "卖家备注": "客服已处理退款",
            },
        )

        payload = order_to_dict(order)

        self.assertEqual(payload["shopName"], "测试旗舰店")
        self.assertEqual(payload["orderSourceText"], "拼多多")
        self.assertEqual(payload["allocationStatusText"], "全部配货")
        self.assertEqual(payload["shippingStatusText"], "全部发货")
        self.assertEqual(payload["auditStatusText"], "审核成功")
        self.assertEqual(payload["paymentTimeText"], "2026-04-27 09:00:00")
        self.assertEqual(payload["refundStatusText"], "√")
        self.assertEqual(payload["sellerRemarkText"], "客服已处理退款")


if __name__ == "__main__":
    unittest.main()
