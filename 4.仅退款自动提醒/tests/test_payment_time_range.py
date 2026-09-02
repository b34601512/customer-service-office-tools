#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import unittest
from datetime import date

from refund_reminder.payment_time_range import parse_payment_date, payment_date_in_recent_days


class PaymentTimeRangeTest(unittest.TestCase):
    def test_parse_payment_date_accepts_common_erp_text(self) -> None:
        self.assertEqual(parse_payment_date("2026-06-17 10:00:00"), date(2026, 6, 17))
        self.assertEqual(parse_payment_date("2026/06/17 10:00:00"), date(2026, 6, 17))
        self.assertIsNone(parse_payment_date("无效日期"))

    def test_payment_date_range_treats_one_day_as_today(self) -> None:
        today = date(2026, 6, 17)

        self.assertTrue(payment_date_in_recent_days("2026-06-17 09:00:00", 1, today=today))
        self.assertFalse(payment_date_in_recent_days("2026-06-16 23:59:59", 1, today=today))
        self.assertTrue(payment_date_in_recent_days("2026-06-16 23:59:59", 2, today=today))
        self.assertFalse(payment_date_in_recent_days("2026-06-15 23:59:59", 2, today=today))
        self.assertTrue(payment_date_in_recent_days("2026-06-15 09:00:00", 3, today=today))
        self.assertFalse(payment_date_in_recent_days("2026-06-14 23:59:59", 3, today=today))
        self.assertFalse(payment_date_in_recent_days("2026-06-18 00:00:00", 3, today=today))


if __name__ == "__main__":
    unittest.main()
