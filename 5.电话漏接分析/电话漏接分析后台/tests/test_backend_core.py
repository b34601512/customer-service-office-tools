from __future__ import annotations

import os
import threading
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import control_center_window_lifecycle

from missed_call_backend import analysis, maintenance_scheduler, runtime_maintenance, state_store


class AnalysisCoreTest(unittest.TestCase):
    def test_analyze_records_keeps_loss_candidate_and_complaint_receiver(self) -> None:
        loss_records = [
            {
                "phone": "13800138000",
                "loss_time": datetime(2026, 6, 30, 9, 0, 0),
                "loss_time_text": "2026-06-30 09:00:00",
                "wait_seconds": 90,
                "ivr_seconds": 30,
                "queue_seconds": 60,
                "lost_stage": "排队阶段",
                "city": "深圳",
                "did": "0755",
                "called_number_text": "0755",
                "queue": "800",
            }
        ]
        inbound_records = [
            {
                "phone": "13800138000",
                "inbound_time": datetime(2026, 6, 30, 9, 5, 0),
                "inbound_time_text": "2026-06-30 09:05:00",
                "talk_seconds": 120,
                "wait_seconds": 5,
                "agent": "投诉座席",
                "agent_extension": "13800000000",
                "city": "深圳",
                "called_number_text": "0755",
            }
        ]
        outbound_records = [
            {
                "phone": "13800138000",
                "outbound_time": datetime(2026, 6, 30, 9, 10, 0),
                "outbound_time_text": "2026-06-30 09:10:00",
                "talk_seconds": 60,
                "agent": "客服",
                "agent_extension": "8001",
                "city": "深圳",
            }
        ]
        with patch("missed_call_backend.analysis.load_agent_mapping", return_value={"8001": "苏哲"}):
            with patch("missed_call_backend.analysis.load_complaint_config", return_value={"receiverPhone": "13800000000"}):
                result = analysis.analyze_records(loss_records, inbound_records, outbound_records)
        self.assertEqual(result["summary"]["candidateCount"], 1)
        self.assertEqual(result["candidates"][0]["phone"], "13800138000")
        self.assertEqual(result["complaints"]["summary"]["complaintPhoneCount"], 1)
        self.assertEqual(result["complaints"]["phones"][0]["latestInboundAgentExtension"], "13800000000")

    def test_complaint_summary_accepts_multiple_receiver_phones(self) -> None:
        inbound_records = [
            {
                "phone": "13800138000",
                "inbound_time": datetime(2026, 6, 30, 9, 0, 0),
                "inbound_time_text": "2026-06-30 09:00:00",
                "talk_seconds": 60,
                "wait_seconds": 5,
                "agent": "投诉座席A",
                "agent_extension": "13800000000",
                "city": "深圳",
                "called_number_text": "0755",
            },
            {
                "phone": "13900139000",
                "inbound_time": datetime(2026, 6, 30, 9, 1, 0),
                "inbound_time_text": "2026-06-30 09:01:00",
                "talk_seconds": 0,
                "wait_seconds": 8,
                "agent": "投诉座席B",
                "agent_extension": "17712345678",
                "city": "广州",
                "called_number_text": "020",
            },
        ]
        with patch("missed_call_backend.analysis.load_agent_mapping", return_value={}):
            with patch(
                "missed_call_backend.analysis.load_complaint_config",
                return_value={"receiverPhones": ["13800000000", "17712345678"], "receiverPhone": "13800000000"},
            ):
                result = analysis.analyze_records([], inbound_records, [])
        self.assertEqual(result["complaints"]["summary"]["complaintPhoneCount"], 2)
        self.assertEqual(result["complaints"]["summary"]["complaintCallCount"], 2)
        self.assertEqual([item["complaintCallCount"] for item in result["complaints"]["receiverSummary"]], [1, 1])


class FollowupStateTest(unittest.TestCase):
    def test_followup_state_roundtrip_uses_normalized_phone(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            state_file = Path(temp_dir) / "followup_state.json"
            with patch.object(state_store, "FOLLOWUP_STATE_FILE", state_file):
                with patch.object(state_store, "write_log", lambda *_args: None):
                    record = state_store.update_followup_state(
                        "138-0013-8000",
                        status="processing",
                        note_text="已经安排回访",
                        contact_name="张三",
                        phone_note_text="重点客户",
                    )
                    records = state_store.load_followup_state()
        self.assertEqual(record["phone"], "13800138000")
        self.assertEqual(records["13800138000"]["status"], "processing")
        self.assertEqual(records["13800138000"]["contactName"], "张三")


class RuntimeMaintenanceTest(unittest.TestCase):
    def test_old_download_records_keep_latest_pointer_and_recent_records(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            records_dir = root / "records"
            records_dir.mkdir()
            latest_file = root / "latest.json"
            latest_file.write_text('{"recordId":"record_000"}', encoding="utf-8")
            for index in range(35):
                record_dir = records_dir / f"record_{index:03d}"
                record_dir.mkdir()
                os.utime(record_dir, (index + 1, index + 1))
            moved_names: list[str] = []

            def fake_move(path: Path, _category: str) -> Path:
                moved_names.append(path.name)
                return path

            with patch.object(runtime_maintenance, "DOWNLOAD_RECORD_DIR", records_dir):
                with patch.object(runtime_maintenance, "LATEST_DOWNLOAD_RESULT_FILE", latest_file):
                    with patch.object(runtime_maintenance, "DOWNLOAD_RECORD_KEEP_COUNT", 30):
                        with patch.object(runtime_maintenance, "move_path_to_backup", fake_move):
                            moved_count = runtime_maintenance.move_old_download_records()
        self.assertEqual(moved_count, 4)
        self.assertNotIn("record_000", moved_names)
        self.assertIn("record_001", moved_names)


class MaintenanceSchedulerTest(unittest.TestCase):
    def test_periodic_runner_runs_until_stopped(self) -> None:
        finished_event = threading.Event()
        run_count = 0

        def fake_maintenance_action() -> dict[str, int]:
            """模拟维护动作，确认定时器会持续触发。"""
            nonlocal run_count
            run_count += 1
            if run_count >= 2:
                finished_event.set()
            return {}

        runner = maintenance_scheduler.PeriodicMaintenanceRunner(
            maintenance_action=fake_maintenance_action,
            interval_seconds=0.01,
            initial_delay_seconds=0,
        )
        with patch.object(maintenance_scheduler, "write_log", lambda *_args: None):
            runner.start()
            self.assertTrue(finished_event.wait(1))
            runner.stop()
        self.assertGreaterEqual(run_count, 2)
        self.assertFalse(runner.is_running())

    def test_periodic_runner_logs_error_and_continues(self) -> None:
        continued_event = threading.Event()
        run_count = 0
        captured_errors: list[str] = []

        def fake_maintenance_action() -> dict[str, int]:
            """先制造一次失败，再确认下一轮还能继续执行。"""
            nonlocal run_count
            run_count += 1
            if run_count == 1:
                raise RuntimeError("模拟维护失败")
            continued_event.set()
            return {}

        def fake_error_log(_main_action: str, _module_name: str, error: BaseException) -> None:
            """记录测试中捕获的错误，避免写入真实日志。"""
            captured_errors.append(str(error))

        runner = maintenance_scheduler.PeriodicMaintenanceRunner(
            maintenance_action=fake_maintenance_action,
            interval_seconds=0.01,
            initial_delay_seconds=0,
        )
        with patch.object(maintenance_scheduler, "write_log", lambda *_args: None):
            with patch.object(maintenance_scheduler, "write_error_log", fake_error_log):
                runner.start()
                self.assertTrue(continued_event.wait(1))
                runner.stop()
        self.assertEqual(captured_errors, ["模拟维护失败"])
        self.assertGreaterEqual(run_count, 2)


class BrowserLifecycleTest(unittest.TestCase):
    def test_profile_query_uses_short_safe_command(self) -> None:
        captured_scripts: list[str] = []

        def fake_powershell(script: str, **_kwargs: object) -> str:
            captured_scripts.append(script)
            return "1234\n"

        profile_path = Path(r"D:\runtime\browser_profiles\phone_data_downloader")
        with patch.object(control_center_window_lifecycle, "_run_powershell", fake_powershell):
            process_ids = control_center_window_lifecycle.find_browser_process_ids_by_profiles([profile_path])

        self.assertEqual(process_ids, ["1234"])
        self.assertEqual(len(captured_scripts), 1)
        self.assertLess(len(captured_scripts[0]), 350)

    def test_powershell_runner_keeps_short_script_plain(self) -> None:
        with patch.object(control_center_window_lifecycle.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = ""
            run.return_value.stderr = ""
            control_center_window_lifecycle._run_powershell("Write-Output 123")

        command = run.call_args.args[0]
        self.assertIn("-Command", command)
        self.assertNotIn("-EncodedCommand", command)
        self.assertIn("Write-Output 123", command)


if __name__ == "__main__":
    unittest.main()
