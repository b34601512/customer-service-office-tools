#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

from app_entry import StartupLogger
from refund_reminder.config import default_config
from refund_reminder.control_service import ControlService, _format_exception
from refund_reminder.order_detector import ProblemOrder, detect_problem_orders_from_exported_rows


def detection_for_export_rows(config, platform_order_numbers: list[str] | None = None, *, payment_date: str | None = None):
    # 该函数模拟 ERP 导出的退款订单表，控制服务测试不再依赖操作日志。
    rows = []
    default_payment_date = date.today().isoformat()
    for index, number in enumerate(platform_order_numbers or ["P001"]):
        rows.append(
            [
                number,
                f"SO{index + 1:03d}",
                "测试店",
                "拼多多",
                "全部配货",
                "全部发货",
                "审核成功",
                "交易成功",
                "598.00",
                f"{payment_date or default_payment_date} 10:00:00",
                "√",
                "退款订单",
            ]
        )
    return detect_problem_orders_from_exported_rows(
        {
            "source": "unit-xlsx",
            "headers": ["平台单号", "订单编号", "店铺", "订单来源", "配货状态", "发货状态", "审核", "平台交易状态", "支付金额", "支付日期", "退款", "退款状态"],
            "rows": rows,
        },
        config.detection,
    )


class ControlServiceTest(unittest.TestCase):
    def test_polling_logs_are_deduped_but_business_logs_remain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            service.log_lines.clear()
            repeated = "订单页识别状态：订单查询关键字=无，命中 0/3 个必要特征「无」。"
            service._append_log(repeated)
            service._append_log(repeated)
            service._append_log("配置已保存。")
            service._append_log("配置已保存。")
            self.assertEqual([line.endswith(repeated) for line in service.log_lines].count(True), 1)
            self.assertEqual([line.endswith("配置已保存。") for line in service.log_lines].count(True), 2)

    def test_run_log_file_is_truncated_on_service_start_and_appended(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.json"
            run_log = Path(tmp) / "logs" / "本次运行日志.txt"
            run_log.parent.mkdir(parents=True, exist_ok=True)
            run_log.write_text("旧日志不应保留\n", encoding="utf-8")

            service = ControlService(config_path=config_path)
            service._append_log("本次运行测试日志。")

            text = run_log.read_text(encoding="utf-8")
            self.assertNotIn("旧日志不应保留", text)
            self.assertIn("后台已待命", text)
            self.assertIn("本次运行测试日志。", text)

    def test_startup_logger_uses_single_fixed_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old_log = root / "logs" / "startup.log"
            old_log.parent.mkdir(parents=True, exist_ok=True)
            old_log.write_text("旧启动日志不应保留\n", encoding="utf-8")

            logger = StartupLogger(root)
            logger.write("本次启动日志")

            self.assertEqual(logger.run_log, root / "logs" / "startup.log")
            text = logger.run_log.read_text(encoding="utf-8")
            self.assertNotIn("旧启动日志不应保留", text)
            self.assertIn("START", text)
            self.assertIn("本次启动日志", text)

    def test_format_exception_keeps_exception_type(self) -> None:
        self.assertEqual(_format_exception(TypeError("参数冲突")), "TypeError: 参数冲突")

    def test_runtime_snapshot_includes_workflow_steps_with_timestamps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")

            initial_steps = service.get_snapshot()["runtime"]["workflowSteps"]
            self.assertEqual([step["key"] for step in initial_steps], ["browser", "monitor", "scan", "alert", "stats"])
            self.assertTrue(all(step["updated_at"] == 0 for step in initial_steps))

            service._set_indicator("browser", "ok", "ERP 已就绪。")
            steps = service.get_snapshot()["runtime"]["workflowSteps"]
            browser_step = next(step for step in steps if step["key"] == "browser")

            self.assertEqual(browser_step["state"], "ok")
            self.assertEqual(browser_step["detail"], "ERP 已就绪。")
            self.assertGreater(browser_step["updated_at"], 0)

    def test_detection_summary_logs_once_when_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            service.log_lines.clear()
            detection = detection_for_export_rows(service.config)
            service._append_detection_summary(detection)
            first_count = len(service.log_lines)
            service._append_detection_summary(detection)
            self.assertEqual(len(service.log_lines), first_count)
            self.assertTrue(any("订单判定规则" in line and "通知付款范围由运行配置控制" in line for line in service.log_lines))
            self.assertTrue(any("订单判定结果" in line and "采集 1 个退款候选" in line for line in service.log_lines))
            self.assertFalse(any("逐行判定" in line for line in service.log_lines))

    def test_save_form_ignores_legacy_refund_application_date(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            payload = service.get_form_state()
            self.assertNotIn("refund_application_date", payload)
            payload["refund_application_date"] = "2026-04-28"
            payload["max_notification_orders"] = "3"
            payload["payment_time_range_days"] = "5"
            saved = service.save_form(payload)

            self.assertFalse(hasattr(service.config.detection, "refund_application_date"))
            self.assertNotIn("refund_application_date", saved["detection"])
            self.assertEqual(service.config.notification.max_notification_orders, 3)
            self.assertEqual(service.config.notification.payment_time_range_days, 5)

    def test_start_monitor_queues_restart_while_stop_is_pending(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            release_thread = threading.Event()
            thread = threading.Thread(target=lambda: release_thread.wait(timeout=2), daemon=True)
            thread.start()
            service.monitor_thread = thread
            service.monitor_stop_event.set()

            service.start_monitor(source="测试：停止中重新开始")

            self.assertTrue(service._monitor_restart_requested)
            self.assertTrue(service.monitor_stop_event.is_set())
            self.assertEqual(service.status_phase, "重启中")
            self.assertTrue(any("重新开始请求" in line for line in service.log_lines))
            release_thread.set()
            thread.join(timeout=2)

    def test_start_monitor_requires_erp_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")

            with self.assertRaisesRegex(RuntimeError, "请先点击「打开 ERP」"):
                service.start_monitor(source="测试：未打开 ERP")

            self.assertIsNone(service.monitor_thread)
            self.assertEqual(service.indicators["monitor"].state, "warning")
            self.assertTrue(any("启动监控失败" in line for line in service.log_lines))

    def test_auto_start_monitor_waits_for_erp_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.json"
            config_path.write_text('{"login": {}, "monitor": {"auto_start_monitor": true}, "detection": {}, "notification": {}}', encoding="utf-8")

            service = ControlService(config_path=config_path)

            self.assertIsNone(service.monitor_thread)
            self.assertEqual(service.indicators["monitor"].state, "warning")
            self.assertTrue(any("自动启动监控已跳过" in line for line in service.log_lines))

    def test_start_monitor_allows_erp_ready_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            service._set_indicator("browser", "ok", "测试 ERP 已就绪。")
            service._monitor_worker = lambda: None  # type: ignore[method-assign]

            service.start_monitor(source="测试：ERP 已就绪")
            service.monitor_thread.join(timeout=2)

            self.assertIsNotNone(service.monitor_thread)
            self.assertFalse(service.monitor_thread.is_alive())
            self.assertTrue(any("启动自动监控" in line for line in service.log_lines))

    def test_monitor_worker_consumes_restart_request_after_stop(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            scan_count = 0
            service.monitor_stop_event.set()
            service._monitor_restart_requested = True

            def fake_scan(_notify: bool) -> None:
                nonlocal scan_count
                scan_count += 1
                service.monitor_stop_event.set()

            service._scan_once_worker = fake_scan  # type: ignore[method-assign]

            service._monitor_worker()

            self.assertEqual(scan_count, 1)
            self.assertFalse(service._monitor_restart_requested)
            self.assertTrue(any("按重新开始请求恢复" in line for line in service.log_lines))

    def test_monitor_worker_keeps_running_after_single_scan_failure(self) -> None:
        class FakeStopEvent:
            def __init__(self) -> None:
                # 该测试事件让监控循环不真实等待 5 分钟，专门验证失败后能进入下一轮。
                self.stopped = False

            def is_set(self) -> bool:
                # 该函数模拟 threading.Event.is_set。
                return self.stopped

            def set(self) -> None:
                # 该函数模拟用户或测试请求停止监控。
                self.stopped = True

            def clear(self) -> None:
                # 该函数模拟重新开始监控时清空停止信号。
                self.stopped = False

            def wait(self, timeout: float | None = None) -> bool:
                # 该函数直接返回当前停止状态，避免自动化测试真实等待间隔时间。
                return self.stopped

        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            fake_stop_event = FakeStopEvent()
            service.monitor_stop_event = fake_stop_event  # type: ignore[assignment]
            scan_count = 0

            def fake_scan(_notify: bool) -> None:
                # 该函数先模拟一次 ERP 偶发失败，再用第二轮证明监控线程没有退出。
                nonlocal scan_count
                scan_count += 1
                if scan_count == 1:
                    raise RuntimeError("测试扫描失败")
                fake_stop_event.set()

            service._scan_once_worker = fake_scan  # type: ignore[method-assign]

            service._monitor_worker()

            self.assertEqual(scan_count, 2)
            self.assertTrue(any("本轮扫描失败，已跳过本轮" in line for line in service.log_lines))
            self.assertFalse(any("自动监控异常" in line for line in service.log_lines))

    def test_snapshot_includes_app_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            metadata = service.get_snapshot()["appMetadata"]
            self.assertEqual(metadata["version"], "v0.01")
            self.assertEqual(metadata["author_name"], "黎路遥")
            self.assertEqual(metadata["author_wechat"], "luyao2089")
            self.assertEqual(metadata["official_website"], "luyao2089.cc")

    def test_successful_monitor_count_increments_and_persists(self) -> None:
        class FakeBrowser:
            def __init__(self, detection):
                self.detection = detection

            def scan_orders(self, _config, status=None, on_problem_order=None):
                return SimpleNamespace(detection=self.detection)

        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.json"
            service = ControlService(config_path=config_path)
            detection = detection_for_export_rows(service.config)
            service.browser = FakeBrowser(detection)

            service._scan_once_worker(notify=False)

            runtime = service.get_snapshot()["runtime"]
            self.assertEqual(runtime["successfulMonitorCount"], 1)
            self.assertGreater(runtime["lastSuccessfulScanAt"], 0)
            self.assertIn("累计成功监控 1 次", runtime["indicators"]["stats"]["detail"])

            reloaded = ControlService(config_path=config_path)
            self.assertEqual(reloaded.get_snapshot()["runtime"]["successfulMonitorCount"], 1)

    def test_control_panel_time_uses_full_datetime(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            timestamp = time.mktime((2026, 6, 17, 10, 4, 9, 0, 0, -1))

            self.assertEqual(service._format_time(timestamp), "2026年6月17日10:04:09")

    def test_next_scan_countdown_only_shows_on_monitor_step(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            service.status_phase = "监控中"
            service.last_scan_at = time.time() - 30
            service.next_scan_at = time.time() + 125
            service._set_indicator("monitor", "running", "等待下一次自动查询。")

            runtime = service.get_snapshot()["runtime"]
            monitor_step = next(step for step in runtime["workflowSteps"] if step["key"] == "monitor")

            self.assertNotIn("下次查询", runtime["statusText"])
            self.assertIn("最近扫描", runtime["statusText"])
            self.assertRegex(monitor_step["detail"], r"等待下一次自动查询：约 2分\d+秒后。")
            self.assertEqual(runtime["indicators"]["monitor"]["detail"], monitor_step["detail"])

    def test_scan_adds_problem_order_before_summary_returns(self) -> None:
        class FakeBrowser:
            def __init__(self, detection):
                self.detection = detection
                self.snapshot_during_scan: list[dict] = []

            def scan_orders(self, _config, status=None, on_problem_order=None):
                if on_problem_order is None:
                    raise RuntimeError("测试失败：扫描回调不能为空")
                on_problem_order(self.detection.problem_orders[0])
                self.snapshot_during_scan = service.get_snapshot()["runtime"]["problemOrders"]
                return SimpleNamespace(detection=self.detection)

        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            detection = detection_for_export_rows(service.config)
            browser = FakeBrowser(detection)
            alerted_keys: list[tuple[str, ...]] = []
            service.browser = browser
            service.notification_sender = lambda _config, orders: alerted_keys.append(tuple(order.key for order in orders))

            service._scan_once_worker(notify=True)

            order = detection.problem_orders[0]
            self.assertEqual([item["key"] for item in browser.snapshot_during_scan], [order.key])
            self.assertEqual(alerted_keys, [(order.key,)])
            self.assertTrue(any("已实时添加待提醒订单" in line for line in service.log_lines))

    def test_scan_progress_updates_visible_workflow_step(self) -> None:
        class FakeBrowser:
            def __init__(self, detection):
                self.detection = detection
                self.workflow_during_progress: dict | None = None

            def scan_orders(self, _config, status=None, on_problem_order=None):
                if status is None:
                    raise RuntimeError("测试失败：扫描进度回调不能为空")
                status("已点击查询，固定等待 5 秒后开始导出。")
                steps = service.get_snapshot()["runtime"]["workflowSteps"]
                self.workflow_during_progress = next(step for step in steps if step["key"] == "scan")
                return SimpleNamespace(detection=self.detection)

        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            detection = detection_for_export_rows(service.config)
            browser = FakeBrowser(detection)
            service.browser = browser

            service._scan_once_worker(notify=False)

            self.assertIsNotNone(browser.workflow_during_progress)
            assert browser.workflow_during_progress is not None
            self.assertEqual(browser.workflow_during_progress["state"], "running")
            self.assertIn("固定等待 5 秒", browser.workflow_during_progress["detail"])
            self.assertGreater(browser.workflow_during_progress["updated_at"], 0)
            self.assertTrue(any("固定等待 5 秒" in line for line in service.log_lines))

    def test_mark_order_handled_keeps_order_visible_but_marks_handled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            order = ProblemOrder(
                row_index=0,
                identity="订单编号:SO001",
                summary="第1行｜订单编号:SO001",
                key="key-so001",
                row={
                    "订单编号": "SO001",
                    "平台单号": "P001",
                    "店铺名称": "测试店",
                    "订单来源": "拼多多",
                    "配货状态": "全部配货",
                    "发货状态": "全部发货",
                    "审核": "审核成功",
                    "支付日期": "2026-04-27 10:37:11",
                },
                payment_time_text="2026-04-27 10:37:11",
                refund_status_text="√",
            )
            service.last_problem_orders = (order,)
            marked = service.mark_order_handled(order.key)
            self.assertEqual(marked["orderNumber"], "SO001")
            self.assertEqual(marked["platformOrderNumber"], "P001")
            self.assertEqual(marked["copyOrderNumber"], "P001")
            self.assertEqual(marked["paymentTimeText"], "2026-04-27 10:37:11")
            self.assertEqual(marked["refundStatusText"], "√")
            self.assertTrue(marked["handled"])
            self.assertFalse(marked["verifying"])
            self.assertFalse(marked["processing"])
            self.assertEqual(service.last_problem_orders, (order,))
            self.assertTrue(service.handled_orders.is_handled(order.key))
            runtime = service.get_snapshot()["runtime"]
            self.assertEqual(len(runtime["problemOrders"]), 1)
            self.assertTrue(runtime["problemOrders"][0]["handled"])

            restored = service.set_order_handled(order.key, handled=False)
            self.assertFalse(restored["handled"])
            self.assertFalse(restored["verifying"])
            self.assertFalse(service.handled_orders.is_handled(order.key))
            runtime = service.get_snapshot()["runtime"]
            self.assertEqual(len(runtime["problemOrders"]), 1)
            self.assertFalse(runtime["problemOrders"][0]["handled"])

    def test_verifying_processing_and_note_persist_after_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.json"
            order = ProblemOrder(
                row_index=0,
                identity="平台单号:P001",
                summary="第1行｜平台单号:P001",
                key="key-p001",
                row={
                    "订单编号": "SO001",
                    "平台单号": "P001",
                    "店铺名称": "测试店",
                    "订单来源": "拼多多",
                    "配货状态": "全部配货",
                    "发货状态": "全部发货",
                    "审核": "审核成功",
                    "支付日期": "2026-04-27 10:37:11",
                },
            )
            service = ControlService(config_path=config_path)
            service.last_problem_orders = (order,)
            verifying = service.set_order_verifying(order.key, verifying=True)
            processing = service.set_order_processing(order.key, processing=True)
            noted = service.set_order_note(order.key, note_text="客服正在处理")
            self.assertTrue(verifying["verifying"])
            self.assertFalse(processing["verifying"])
            self.assertTrue(processing["processing"])
            self.assertEqual(noted["noteText"], "客服正在处理")

            reloaded = ControlService(config_path=config_path)
            runtime = reloaded.get_snapshot()["runtime"]
            self.assertEqual(len(runtime["problemOrders"]), 1)
            self.assertFalse(runtime["problemOrders"][0]["handled"])
            self.assertFalse(runtime["problemOrders"][0]["verifying"])
            self.assertTrue(runtime["problemOrders"][0]["processing"])
            self.assertEqual(runtime["problemOrders"][0]["noteText"], "客服正在处理")
            self.assertTrue(runtime["problemOrders"][0]["addedAtText"])

    def test_verifying_order_stays_visible_in_middle_column_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            order = ProblemOrder(
                row_index=0,
                identity="平台单号:P001",
                summary="第1行｜平台单号:P001",
                key="key-p001",
                row={"订单编号": "SO001", "平台单号": "P001", "店铺名称": "测试店"},
            )
            service.last_problem_orders = (order,)

            verifying = service.set_order_verifying(order.key, verifying=True)
            runtime = service.get_snapshot()["runtime"]

            self.assertTrue(verifying["verifying"])
            self.assertFalse(verifying["processing"])
            self.assertEqual(len(runtime["problemOrders"]), 1)
            self.assertTrue(runtime["problemOrders"][0]["verifying"])
            self.assertFalse(runtime["problemOrders"][0]["handled"])

    def test_scan_only_alerts_new_pending_orders(self) -> None:
        class FakeBrowser:
            def __init__(self, detections):
                self.detections = list(detections)

            def scan_orders(self, _config, status=None, on_problem_order=None):
                return SimpleNamespace(detection=self.detections.pop(0))

        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            alerted_keys: list[tuple[str, ...]] = []

            def fake_notification_sender(_config, orders):
                alerted_keys.append(tuple(order.key for order in orders))

            first_detection = detection_for_export_rows(service.config, ["P001"])
            second_detection = detection_for_export_rows(service.config, ["P001"])
            third_detection = detection_for_export_rows(service.config, ["P001", "P002"])
            browser = FakeBrowser([first_detection, second_detection, third_detection])
            service.browser = browser
            service.notification_sender = fake_notification_sender

            service._scan_once_worker(notify=True)
            service._scan_once_worker(notify=True)
            service._scan_once_worker(notify=True)

            first_key = first_detection.problem_orders[0].key
            second_key = third_detection.problem_orders[1].key
            self.assertEqual(alerted_keys, [(first_key,), (second_key,)])
            self.assertTrue(any("本次没有新增订单，不发系统通知" in line for line in service.log_lines))

    def test_scan_only_notifies_orders_inside_payment_time_range(self) -> None:
        class FakeBrowser:
            def __init__(self, detections):
                self.detections = list(detections)

            def scan_orders(self, _config, status=None, on_problem_order=None):
                return SimpleNamespace(detection=self.detections.pop(0))

        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            alerted_keys: list[tuple[str, ...]] = []
            today = date.today()
            today_detection = detection_for_export_rows(service.config, ["P001"], payment_date=today.isoformat())
            old_detection = detection_for_export_rows(service.config, ["P002"], payment_date=(today - timedelta(days=1)).isoformat())
            service.browser = FakeBrowser([today_detection, old_detection])
            service.notification_sender = lambda _config, orders: alerted_keys.append(tuple(order.key for order in orders))

            service._scan_once_worker(notify=True)
            service._scan_once_worker(notify=True)

            self.assertEqual(alerted_keys, [(today_detection.problem_orders[0].key,)])
            self.assertTrue(any("超出通知付款范围" in line for line in service.log_lines))

    def test_filter_unhandled_orders_ignores_marked_orders(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            first = ProblemOrder(0, "平台单号:P001", "第1行｜平台单号:P001", "key-p001", {"订单编号": "SO001", "平台单号": "P001"})
            second = ProblemOrder(1, "平台单号:P002", "第2行｜平台单号:P002", "key-p002", {"订单编号": "SO002", "平台单号": "P002"})
            service.last_problem_orders = (first,)
            service.mark_order_handled(first.key)
            active, handled_count = service._filter_unhandled_orders((first, second))
            self.assertEqual(active, (second,))
            self.assertEqual(handled_count, 1)

    def test_snapshot_does_not_show_orders_without_platform_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            service = ControlService(config_path=Path(tmp) / "config.json")
            service.last_problem_orders = (
                ProblemOrder(
                    row_index=0,
                    identity="第1行",
                    summary="第1行",
                    key="key-missing-platform",
                    row={},
                    payment_time_text="2026-06-15 10:54:02",
                    refund_status_text="√",
                ),
            )

            runtime = service.get_snapshot()["runtime"]

            self.assertEqual(runtime["problemOrders"], [])

    def test_snapshot_includes_stored_handled_records_after_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.json"
            order = ProblemOrder(
                row_index=0,
                identity="平台单号:P001",
                summary="第1行｜平台单号:P001",
                key="key-p001",
                row={
                    "订单编号": "SO001",
                    "平台单号": "P001",
                    "店铺名称": "测试店",
                    "订单来源": "拼多多",
                    "配货状态": "全部配货",
                    "发货状态": "全部发货",
                    "审核": "审核成功",
                    "支付日期": "2026-04-27 10:37:11",
                },
                payment_time_text="2026-04-27 10:37:11",
                refund_status_text="√",
            )
            service = ControlService(config_path=config_path)
            service.last_problem_orders = (order,)
            service.mark_order_handled(order.key)

            reloaded = ControlService(config_path=config_path)
            runtime = reloaded.get_snapshot()["runtime"]
            self.assertEqual(len(runtime["problemOrders"]), 1)
            self.assertTrue(runtime["problemOrders"][0]["handled"])
            self.assertEqual(runtime["problemOrders"][0]["platformOrderNumber"], "P001")
            self.assertEqual(runtime["problemOrders"][0]["orderSourceText"], "拼多多")
            self.assertEqual(runtime["problemOrders"][0]["allocationStatusText"], "全部配货")
            self.assertEqual(runtime["problemOrders"][0]["shippingStatusText"], "全部发货")
            self.assertEqual(runtime["problemOrders"][0]["auditStatusText"], "审核成功")
            self.assertEqual(runtime["problemOrders"][0]["paymentTimeText"], "2026-04-27 10:37:11")

    def test_snapshot_includes_stored_unhandled_records_after_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.json"
            order = ProblemOrder(
                row_index=0,
                identity="平台单号:P001",
                summary="第1行｜平台单号:P001",
                key="key-p001",
                row={"订单编号": "SO001", "平台单号": "P001", "店铺名称": "测试店", "支付日期": "2026-04-27 10:37:11"},
                payment_time_text="2026-04-27 10:37:11",
                refund_status_text="√",
            )
            service = ControlService(config_path=config_path)
            service._remember_scanned_problem_orders((order,))

            reloaded = ControlService(config_path=config_path)
            runtime = reloaded.get_snapshot()["runtime"]
            self.assertEqual(len(runtime["problemOrders"]), 1)
            self.assertFalse(runtime["problemOrders"][0]["handled"])
            self.assertEqual(runtime["problemOrders"][0]["platformOrderNumber"], "P001")
            self.assertEqual(runtime["problemOrders"][0]["paymentTimeText"], "2026-04-27 10:37:11")
            self.assertTrue(runtime["problemOrders"][0]["addedAtText"])

    def test_stored_handled_record_can_return_to_pending_after_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.json"
            order = ProblemOrder(
                row_index=0,
                identity="平台单号:P001",
                summary="第1行｜平台单号:P001",
                key="key-p001",
                row={"订单编号": "SO001", "平台单号": "P001", "店铺名称": "测试店", "支付日期": "2026-04-27 10:37:11"},
                payment_time_text="2026-04-27 10:37:11",
                refund_status_text="√",
            )
            service = ControlService(config_path=config_path)
            service.last_problem_orders = (order,)
            service.mark_order_handled(order.key)

            reloaded = ControlService(config_path=config_path)
            restored = reloaded.set_order_handled(order.key, handled=False)
            self.assertFalse(restored["handled"])
            runtime = reloaded.get_snapshot()["runtime"]
            self.assertEqual(len(runtime["problemOrders"]), 1)
            self.assertFalse(runtime["problemOrders"][0]["handled"])
            self.assertEqual(runtime["problemOrders"][0]["platformOrderNumber"], "P001")
            self.assertEqual(runtime["problemOrders"][0]["paymentTimeText"], "2026-04-27 10:37:11")

            marked_again = reloaded.set_order_handled(order.key, handled=True)
            self.assertTrue(marked_again["handled"])
            self.assertTrue(reloaded.handled_orders.is_handled(order.key))


if __name__ == "__main__":
    unittest.main()
