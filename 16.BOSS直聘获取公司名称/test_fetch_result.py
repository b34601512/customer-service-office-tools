#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""采集结果/任务边界回归测试；不访问网站，不启动浏览器。

加载真实 boss_tui.py，只在业务入口注入可控返回值/异常。
依赖模块仅在模块加载期间隔离，不污染其他测试的 sys.modules。
运行：python -m unittest -v test_fetch_result.py
"""

import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock


class FetchResultTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="boss_中文_")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.biz = types.ModuleType("boss_cdp")
        self.biz.__file__ = str(Path(__file__).with_name("boss_cdp.py"))
        self.biz.RESULT_DIR = str(root / "job-result")
        self.biz.PROFILE_DIR = str(root / "profile")
        self.biz.DEFAULT_PORT = 9222
        self.biz.run_fetch = mock.Mock(return_value=[])
        self.biz.close_owned_edge = mock.Mock()
        jd = types.ModuleType("jd_shops")
        jd.default_input_path = lambda: root / "京东店铺.txt"
        shops = types.ModuleType("shop_subjects")
        source = Path(__file__).with_name("boss_tui.py")
        spec = importlib.util.spec_from_file_location("boss_tui_result_test", source)
        self.tui = importlib.util.module_from_spec(spec)
        with mock.patch.dict(sys.modules, {"boss_cdp": self.biz, "jd_shops": jd, "shop_subjects": shops}):
            spec.loader.exec_module(self.tui)
        self.ctx = self.tui.Ctx()
        self.app = types.SimpleNamespace(columns=240, content_height=16, switch_page=mock.Mock())

    def join(self, runner=None):
        runner = runner or self.ctx.tasks
        runner._thread.join(timeout=3)
        self.assertFalse(runner._thread.is_alive(), "测试任务未在期限内结束")
        self.assertTrue(runner.task["done"])
        return runner.task

    def summary(self, runner=None):
        ctx = self.ctx if runner is None else types.SimpleNamespace(tasks=runner)
        return self.tui.LogPage(ctx).render(self.app)[1]

    def start_fetch(self, result=None, error=None):
        self.biz.run_fetch.return_value = result
        self.biz.run_fetch.side_effect = error
        self.assertTrue(self.ctx.start_fetch(self.app))
        return self.join()

    def test_legacy_none_is_never_rendered_as_success(self):
        runner = self.tui.TaskRunner()
        runner.start("抓取 国内电商 @ 深圳", lambda: None)
        self.join(runner)
        summary = self.summary(runner)
        self.assertIn("未返回结果", summary)
        self.assertNotIn("已完成", summary)
        self.assertIn(self.tui.CODES["brightRed"], summary)

    def test_fetch_none_becomes_error_with_traceback(self):
        task = self.start_fetch()
        self.assertIsInstance(task["error"], RuntimeError)
        self.assertIn("None", str(task["error"]))
        self.assertIn("Traceback", task["buf"].getvalue())
        self.assertIn("任务失败", self.summary())
        self.assertNotIn("已完成", self.summary())

    def test_fetch_rejects_non_list_results(self):
        for value in (False, True, {}, (), "None", 0):
            with self.subTest(value=value):
                task = self.start_fetch(result=value)
                self.assertIsInstance(task["error"], TypeError)
                self.assertIn("list", str(task["error"]))
                self.assertNotIn("已完成", self.summary())

    def test_valid_rows_are_preserved_without_replacement(self):
        rows = [{"company": "测试公司", "job_id": "test-only"}]
        task = self.start_fetch(result=rows)
        self.assertIs(task["result"], rows)
        self.assertIsNone(task["error"])
        self.assertIn("共 1 条", self.summary())
        self.assertIn("已完成", self.summary())

    def test_empty_rows_are_not_reported_as_exported(self):
        task = self.start_fetch(result=[])
        self.assertEqual(task["result"], [])
        self.assertIsNone(task["error"])
        self.assertIn("0 条", self.summary())
        self.assertNotIn("已导出", self.summary())
        self.assertNotIn("已完成", self.summary())

    def test_worker_captures_system_exit_even_with_zero_code(self):
        for code in (0, 2, None):
            with self.subTest(code=code):
                runner = self.tui.TaskRunner()
                error = SystemExit(code)
                runner.start("直接线程任务", mock.Mock(side_effect=error))
                task = self.join(runner)
                self.assertIs(task["error"], error)
                self.assertIn("SystemExit", task["buf"].getvalue())
                self.assertIn("任务失败", self.summary(runner))
                self.assertNotIn("已完成", self.summary(runner))

    def test_fetch_system_exit_is_converted_to_failure(self):
        error = SystemExit(0)
        task = self.start_fetch(error=error)
        self.assertIsInstance(task["error"], RuntimeError)
        self.assertIs(task["error"].__cause__, error)
        self.assertIn("SystemExit", task["buf"].getvalue())
        self.assertNotIn("已完成", self.summary())

    def test_worker_keyboard_interrupt_is_not_success(self):
        runner = self.tui.TaskRunner()
        error = KeyboardInterrupt()
        runner.start("中断", mock.Mock(side_effect=error))
        task = self.join(runner)
        self.assertIs(task["error"], error)
        self.assertIn("KeyboardInterrupt", self.summary(runner))
        self.assertIn("任务失败", self.summary(runner))

    def test_original_exception_and_stderr_are_preserved(self):
        error = RuntimeError("接口异常：测试")

        def fail(*args, **kwargs):
            print("标准输出：测试")
            print("标准错误：测试", file=sys.stderr)
            raise error

        before = (sys.stdout, sys.stderr)
        task = self.start_fetch(error=fail)
        self.assertIs(task["error"], error)
        self.assertEqual((sys.stdout, sys.stderr), before)
        log = Path(task["log_path"]).read_text(encoding="utf-8")
        for expected in ("标准输出：测试", "标准错误：测试", "Traceback", "接口异常：测试"):
            self.assertIn(expected, log)

    def test_failed_login_is_not_success(self):
        self.ctx.tasks.start("登录", lambda: False)
        self.join()
        self.assertIn("登录未完成", self.summary())
        self.assertNotIn("已完成", self.summary())

    def test_successful_login_remains_success(self):
        self.ctx.tasks.start("登录", lambda: True)
        self.join()
        self.assertIn("登录成功", self.summary())

    def test_stopped_fetch_retains_partial_rows(self):
        rows = [{"company": "测试公司"}]

        def stop(*args, progress, stop_event, **kwargs):
            stop_event.set()
            progress(1, 400, "已停止", "已保存1条")
            return rows

        task = self.start_fetch(error=stop)
        self.assertIs(task["result"], rows)
        self.assertIsNone(task["error"])
        self.assertIn("已停止", self.summary())
        self.assertNotIn("已完成", self.summary())

    def test_stop_flag_does_not_hide_fetch_error(self):
        def fail(*args, stop_event, **kwargs):
            stop_event.set()
            raise OSError("保存失败")

        task = self.start_fetch(error=fail)
        self.assertIsInstance(task["error"], OSError)
        self.assertIn("任务失败", self.summary())

    def test_partial_completion_is_preserved(self):
        def partial(*args, progress, **kwargs):
            progress(1, 400, "部分完成", "后续页面失败")
            return [{"company": "测试公司"}]

        task = self.start_fetch(error=partial)
        self.assertIsNone(task["error"])
        self.assertIn("部分完成", self.summary())
        self.assertNotIn("已完成", self.summary())

    def test_all_fetch_parameters_reach_business_function(self):
        self.ctx.config.update(keyword="国内电商", city="深圳", pages=400, format="csv", title_filter="客服")
        task = self.start_fetch(result=[])
        args, kwargs = self.biz.run_fetch.call_args
        self.assertEqual(args, ("国内电商", "深圳", 400, "csv", 3, 9222))
        self.assertEqual(kwargs["title_filter"], "客服")
        self.assertIs(kwargs["stop_event"], task["stop_event"])
        self.assertTrue(callable(kwargs["progress"]))
        self.app.switch_page.assert_called_once_with(2)

    def test_concurrent_task_is_rejected_and_config_is_snapshotted(self):
        entered = threading.Event()
        release = threading.Event()
        received = {}

        def fetch(*args, **kwargs):
            entered.set()
            if not release.wait(2):
                raise TimeoutError("测试同步超时")
            received.update(args=args, kwargs=kwargs)
            return []

        self.biz.run_fetch.side_effect = fetch
        self.ctx.config.update(city="郑州", pages=400, title_filter="客服")
        try:
            self.assertTrue(self.ctx.start_fetch(self.app))
            self.assertTrue(entered.wait(1))
            self.ctx.config.update(city="深圳", pages=1, title_filter="仓管")
            self.assertFalse(self.ctx.start_fetch(self.app))
        finally:
            release.set()
            self.join()
        self.assertEqual(received["args"][1:3], ("郑州", 400))
        self.assertEqual(received["kwargs"]["title_filter"], "客服")
        self.biz.run_fetch.assert_called_once()

    def test_diagnostics_include_loaded_paths_and_source_hash(self):
        task = self.start_fetch(result=[])
        log = Path(task["log_path"]).read_text(encoding="utf-8")
        self.assertIn("fix-none-20260908", log)
        self.assertIn(self.tui.__file__, log)
        self.assertIn(self.biz.__file__, log)
        self.assertIn(sys.executable, log)
        digest = hashlib.sha256(Path(self.tui.__file__).read_bytes()).hexdigest()
        self.assertIn(digest, log)

    def test_missing_source_file_does_not_break_fetch(self):
        self.biz.__file__ = str(Path(self.temp.name) / "missing.py")
        task = self.start_fetch(result=[])
        self.assertIsNone(task["error"])
        self.assertIn("源码指纹不可读", task["buf"].getvalue())

    def test_each_finished_task_has_a_separate_log(self):
        first = self.start_fetch(result=[])
        second = self.start_fetch(result=[])
        self.assertNotEqual(first["log_path"], second["log_path"])
        self.assertTrue(Path(first["log_path"]).is_file())
        self.assertTrue(Path(second["log_path"]).is_file())

    def test_log_write_failure_does_not_overwrite_task_outcome(self):
        for error in (None, ValueError("原始错误")):
            with self.subTest(error=error):
                with mock.patch.object(self.tui.tempfile, "NamedTemporaryFile", side_effect=PermissionError("只读目录")):
                    task = self.start_fetch(result=[], error=error)
                self.assertIs(task["error"], error)
                self.assertIsNone(task["log_path"])
                self.assertIn("只读目录", task["log_error"])
                self.assertIn("日志保存失败", "\n".join(self.tui.LogPage(self.ctx).render(self.app)))

    def test_zero_or_negative_tail_capacity_returns_no_lines(self):
        self.start_fetch(result=[])
        self.assertEqual(self.ctx.tasks.snapshot_lines(0), [])
        self.assertEqual(self.ctx.tasks.snapshot_lines(-1), [])
        self.app.content_height = 4
        self.assertLessEqual(len(self.tui.LogPage(self.ctx).render(self.app)), 4)

    def test_open_log_directory_shortcut(self):
        task = self.start_fetch(result=[])
        with mock.patch.object(self.tui.subprocess, "Popen") as popen:
            self.assertTrue(self.tui.LogPage(self.ctx).handle_key("o", self.app))
        popen.assert_called_once_with(["explorer", os.path.dirname(task["log_path"])])

    def test_auto_none_fails_and_still_cleans_up(self):
        self.biz.run_fetch.return_value = None
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "None"):
                self.tui.main(["--auto", "fetch"])
        self.biz.close_owned_edge.assert_called_once_with()

    def test_auto_system_exit_zero_is_not_reported_as_success(self):
        self.biz.run_fetch.side_effect = SystemExit(0)
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "SystemExit"):
                self.tui.main(["--auto", "fetch"])
        self.biz.close_owned_edge.assert_called_once_with()

    def test_auto_valid_result_keeps_zero_exit_code(self):
        self.biz.run_fetch.return_value = [{"company": "测试公司"}]
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                self.tui.main(["--auto", "fetch"])
        self.assertEqual(raised.exception.code, 0)
        self.biz.close_owned_edge.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
