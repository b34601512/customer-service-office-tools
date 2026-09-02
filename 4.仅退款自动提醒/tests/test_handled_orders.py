#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path

from refund_reminder.handled_orders import HandledOrderRetentionPolicy, HandledOrderStore
from refund_reminder.order_detector import ProblemOrder


class HandledOrderStoreTest(unittest.TestCase):
    def test_mark_order_persists_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime" / "handled_orders.json"
            order = ProblemOrder(
                row_index=0,
                identity="订单编号:SO001",
                summary="第1行｜订单编号:SO001",
                key="key-so001",
                row={"订单编号": "SO001"},
            )
            store = HandledOrderStore(path)
            self.assertFalse(store.is_handled(order.key))
            store.mark_order(
                order,
                order_number="SO001",
                platform_order_number="P001",
                shop_name="测试店",
                payment_time_text="2026-04-27 10:37:11",
                refund_status_text="√",
            )

            reloaded = HandledOrderStore(path)
            self.assertTrue(reloaded.is_handled(order.key))
            self.assertEqual(reloaded.count(), 1)
            records = reloaded.records()
            self.assertEqual(len(records), 1)
            self.assertTrue(records[0].handled)
            self.assertFalse(records[0].verifying)
            self.assertFalse(records[0].processing)
            self.assertEqual(records[0].note_text, "")
            self.assertEqual(records[0].platform_order_number, "P001")
            self.assertEqual(records[0].payment_time_text, "2026-04-27 10:37:11")
            self.assertEqual(records[0].refund_status_text, "√")
            self.assertEqual(records[0].row_label, "第1行")

            unhandled = reloaded.set_handled(order.key, False)
            self.assertFalse(unhandled.handled)
            self.assertFalse(reloaded.is_handled(order.key))
            self.assertEqual(reloaded.count(), 0)

            restored = HandledOrderStore(path)
            self.assertFalse(restored.is_handled(order.key))
            self.assertEqual(restored.records()[0].platform_order_number, "P001")

    def test_remember_order_persists_unhandled_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime" / "handled_orders.json"
            order = ProblemOrder(
                row_index=2,
                identity="平台单号:P003",
                summary="第3行｜平台单号:P003",
                key="key-p003",
                row={"平台单号": "P003"},
            )
            store = HandledOrderStore(path)
            store.remember_order(
                order,
                order_number="SO003",
                platform_order_number="P003",
                shop_name="测试店",
                order_source_text="拼多多",
                allocation_status_text="全部配货",
                shipping_status_text="全部发货",
                audit_status_text="审核成功",
                payment_time_text="2026-04-27 10:37:11",
                refund_status_text="√",
                seller_remark_text="客服已备注拦截",
            )

            reloaded = HandledOrderStore(path)
            records = reloaded.records()
            self.assertEqual(len(records), 1)
            self.assertFalse(records[0].handled)
            self.assertFalse(records[0].verifying)
            self.assertFalse(records[0].processing)
            self.assertFalse(reloaded.is_handled(order.key))
            self.assertEqual(records[0].platform_order_number, "P003")
            self.assertEqual(records[0].order_source_text, "拼多多")
            self.assertEqual(records[0].allocation_status_text, "全部配货")
            self.assertEqual(records[0].shipping_status_text, "全部发货")
            self.assertEqual(records[0].audit_status_text, "审核成功")
            self.assertEqual(records[0].payment_time_text, "2026-04-27 10:37:11")
            self.assertEqual(records[0].refund_status_text, "√")
            self.assertEqual(records[0].seller_remark_text, "客服已备注拦截")
            self.assertEqual(records[0].row_label, "第3行")
            self.assertGreater(records[0].added_at, 0)

            processing = reloaded.set_processing(order.key, True)
            self.assertTrue(processing.processing)
            self.assertFalse(processing.verifying)
            noted = reloaded.set_note(order.key, "客服正在核对")
            self.assertEqual(noted.note_text, "客服正在核对")

            restored = HandledOrderStore(path)
            self.assertTrue(restored.records()[0].processing)
            self.assertFalse(restored.records()[0].verifying)
            self.assertEqual(restored.records()[0].note_text, "客服正在核对")

    def test_verifying_state_persists_and_moves_to_processing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime" / "handled_orders.json"
            order = ProblemOrder(
                row_index=0,
                identity="平台单号:P001",
                summary="第1行｜平台单号:P001",
                key="key-p001",
                row={"平台单号": "P001"},
            )
            store = HandledOrderStore(path)
            store.remember_order(order, order_number="SO001", platform_order_number="P001", shop_name="测试店")

            verifying = store.set_verifying(order.key, True)
            self.assertTrue(verifying.verifying)
            self.assertFalse(verifying.processing)
            restored = HandledOrderStore(path)
            self.assertTrue(restored.records()[0].verifying)

            processing = restored.set_processing(order.key, True)
            self.assertFalse(processing.verifying)
            self.assertTrue(processing.processing)

            handled = restored.mark_order(order, order_number="SO001", platform_order_number="P001", shop_name="测试店")
            self.assertTrue(handled.handled)
            self.assertFalse(handled.verifying)
            self.assertFalse(handled.processing)

    def test_remember_order_keeps_existing_handled_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime" / "handled_orders.json"
            order = ProblemOrder(
                row_index=0,
                identity="平台单号:P001",
                summary="第1行｜平台单号:P001",
                key="key-p001",
                row={"平台单号": "P001"},
            )
            store = HandledOrderStore(path)
            store.mark_order(
                order,
                order_number="SO001",
                platform_order_number="P001",
                shop_name="测试店",
                payment_time_text="2026-04-27 10:37:11",
            )
            first_added_at = store.records()[0].added_at
            time.sleep(0.01)
            store.remember_order(
                order,
                order_number="SO001-NEW",
                platform_order_number="P001",
                shop_name="新店名",
                payment_time_text="2026-04-27 11:00:00",
            )

            reloaded = HandledOrderStore(path)
            records = reloaded.records()
            self.assertTrue(reloaded.is_handled(order.key))
            self.assertTrue(records[0].handled)
            self.assertFalse(records[0].verifying)
            self.assertFalse(records[0].processing)
            self.assertEqual(records[0].order_number, "SO001-NEW")
            self.assertEqual(records[0].shop_name, "新店名")
            self.assertEqual(records[0].payment_time_text, "2026-04-27 11:00:00")
            self.assertEqual(records[0].added_at, first_added_at)

    def test_mark_handled_clears_processing_but_keeps_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime" / "handled_orders.json"
            order = ProblemOrder(
                row_index=0,
                identity="平台单号:P001",
                summary="第1行｜平台单号:P001",
                key="key-p001",
                row={"平台单号": "P001"},
            )
            store = HandledOrderStore(path)
            store.remember_order(order, order_number="", platform_order_number="P001", shop_name="", payment_time_text="")
            store.set_processing(order.key, True)
            store.set_note(order.key, "已经联系店铺")
            handled = store.mark_order(order, order_number="", platform_order_number="P001", shop_name="", payment_time_text="")
            self.assertTrue(handled.handled)
            self.assertFalse(handled.processing)
            self.assertEqual(handled.note_text, "已经联系店铺")

    def test_load_records_skips_records_without_platform_order_number(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime" / "handled_orders.json"
            path.parent.mkdir(parents=True)
            path.write_text(
                """
                {
                  "version": 7,
                  "orders": {
                    "missing-platform": {
                      "key": "missing-platform",
                      "handled": false,
                      "processing": false,
                      "added_at": 1,
                      "marked_at": 0,
                      "updated_at": 1,
                      "summary": "第1行",
                      "order_number": "",
                      "platform_order_number": "",
                      "shop_name": "",
                      "refund_application_time_text": "",
                      "refund_application_note_text": "",
                      "note_text": "",
                      "row_label": "第1行",
                      "identity": "第1行"
                    },
                    "missing-platform-with-refund-time": {
                      "key": "missing-platform-with-refund-time",
                      "handled": false,
                      "processing": false,
                      "added_at": 3,
                      "marked_at": 0,
                      "updated_at": 3,
                      "summary": "第3行",
                      "order_number": "",
                      "platform_order_number": "",
                      "shop_name": "",
                      "refund_application_time_text": "2026-04-27 10:00:00",
                      "refund_application_note_text": "更新退款状态",
                      "note_text": "",
                      "row_label": "第3行",
                      "identity": "第3行"
                    },
                    "valid-platform": {
                      "key": "valid-platform",
                      "handled": false,
                      "processing": false,
                      "added_at": 2,
                      "marked_at": 0,
                      "updated_at": 2,
                      "summary": "第2行｜平台单号:P002",
                      "order_number": "",
                      "platform_order_number": "P002",
                      "shop_name": "",
                      "refund_application_time_text": "",
                      "refund_application_note_text": "",
                      "note_text": "",
                      "row_label": "第2行",
                      "identity": "平台单号:P002"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )

            store = HandledOrderStore(path)

            records = store.records()
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0].key, "valid-platform")

    def test_load_records_hides_invalid_platform_order_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime" / "handled_orders.json"
            path.parent.mkdir(parents=True)
            path.write_text(
                """
                {
                  "version": 9,
                  "orders": {
                    "dirty-token": {
                      "key": "dirty-token",
                      "handled": false,
                      "processing": false,
                      "added_at": 1,
                      "marked_at": 0,
                      "updated_at": 1,
                      "summary": "第1行｜平台单号:$CpUjQHD9WXFFt3O+QVzGlA==$1$",
                      "order_number": "",
                      "platform_order_number": "$CpUjQHD9WXFFt3O+QVzGlA==$1$",
                      "shop_name": "",
                      "refund_application_time_text": "2026-06-15 10:54:02",
                      "refund_application_note_text": "更新退款状态",
                      "note_text": "",
                      "row_label": "第1行",
                      "identity": "平台单号:$CpUjQHD9WXFFt3O+QVzGlA==$1$"
                    }
                  }
                }
                """,
                encoding="utf-8",
            )

            records = HandledOrderStore(path).records()

            self.assertEqual(records, ())

    def test_remember_order_rejects_invalid_platform_order_number(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "runtime" / "handled_orders.json"
            order = ProblemOrder(
                row_index=0,
                identity="第1行",
                summary="第1行",
                key="key-dirty",
                row={},
            )
            store = HandledOrderStore(path)

            with self.assertRaisesRegex(RuntimeError, "平台单号无效"):
                store.remember_order(
                    order,
                    order_number="",
                    platform_order_number="$CpUjQHD9WXFFt3O+QVzGlA==$1$",
                    shop_name="",
                    payment_time_text="2026-06-15 10:54:02",
                )

    def test_old_handled_records_are_archived_but_pending_records_stay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "runtime" / "handled_orders.json"
            path.parent.mkdir(parents=True)
            old_time = time.time() - 60 * 60 * 24 * 40
            current_time = time.time()
            path.write_text(
                json.dumps(
                    {
                        "version": 15,
                        "orders": {
                            "old-handled": self._raw_record("old-handled", "P001", handled=True, updated_at=old_time),
                            "old-pending": self._raw_record("old-pending", "P002", handled=False, updated_at=old_time),
                            "new-handled": self._raw_record("new-handled", "P003", handled=True, updated_at=current_time),
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            store = HandledOrderStore(
                path,
                archive_root=root / "backup" / "handled_orders",
                retention_policy=HandledOrderRetentionPolicy(handled_keep_days=7, max_current_records=10),
            )

            keys = {record.key for record in store.records()}
            self.assertEqual(keys, {"old-pending", "new-handled"})
            archive_files = list((root / "backup" / "handled_orders").glob("handled_orders_archive_*.json"))
            self.assertEqual(len(archive_files), 1)
            archived = json.loads(archive_files[0].read_text(encoding="utf-8"))
            self.assertEqual(set(archived["orders"].keys()), {"old-handled"})

    def test_record_count_limit_only_moves_oldest_handled_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "runtime" / "handled_orders.json"
            path.parent.mkdir(parents=True)
            now = time.time()
            path.write_text(
                json.dumps(
                    {
                        "version": 15,
                        "orders": {
                            "pending": self._raw_record("pending", "P000", handled=False, updated_at=now - 1000),
                            "handled-old": self._raw_record("handled-old", "P001", handled=True, updated_at=now - 900),
                            "handled-new": self._raw_record("handled-new", "P002", handled=True, updated_at=now - 100),
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            store = HandledOrderStore(
                path,
                archive_root=root / "backup" / "handled_orders",
                retention_policy=HandledOrderRetentionPolicy(handled_keep_days=90, max_current_records=2),
            )

            self.assertEqual({record.key for record in store.records()}, {"pending", "handled-new"})
            archive_files = list((root / "backup" / "handled_orders").glob("handled_orders_archive_*.json"))
            archived = json.loads(archive_files[0].read_text(encoding="utf-8"))
            self.assertEqual(set(archived["orders"].keys()), {"handled-old"})

    @staticmethod
    def _raw_record(key: str, platform_order_number: str, *, handled: bool, updated_at: float) -> dict[str, object]:
        # 该函数用于生成持久化 JSON 样本，专门验证保留策略不依赖内存对象。
        return {
            "key": key,
            "handled": handled,
            "verifying": False,
            "processing": False,
            "added_at": updated_at,
            "marked_at": updated_at if handled else 0,
            "updated_at": updated_at,
            "summary": f"第1行｜平台单号:{platform_order_number}",
            "order_number": "",
            "platform_order_number": platform_order_number,
            "shop_name": "测试店",
            "payment_time_text": "2026-06-15 10:00:00",
            "refund_status_text": "√",
            "note_text": "",
            "row_label": "第1行",
            "identity": f"平台单号:{platform_order_number}",
        }


if __name__ == "__main__":
    unittest.main()
