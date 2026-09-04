#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selftest.py —— 16 号项目自动化自检（依据 SoftTalk #2705「AI 无界面真实运行」原则）
- 直接调用业务真源 boss_cdp，不绕界面、不留测试旁路、不做假路径
- 导出：写真实临时文件并读回校验（CSV BOM/列/中文、JSON 结构）
- TUI：无头渲染全部页面帧 + 按键分发 + 表单编辑 + 任务线程（真实捕获 stdout）
- 乱码自检：帧与文件全部按 UTF-8 合法解码，无替换符/无乱码字节
- Edge：--with-edge 真实启动独立 Edge 并探测 CDP 端口
- 真实抓取：--with-real-fetch 且已登录时，真实网络抓 1 页并校验结果文件
用法：
  python selftest.py                  # 默认：全部逻辑 + 真实文件校验
  python selftest.py --with-edge      # 追加真实 Edge/CDP 探测
  python selftest.py --with-real-fetch # 追加真实网络抓取（需已扫码登录）
"""

import argparse
import contextlib
import csv
import io
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock
from websocket import WebSocketTimeoutException, create_connection

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import boss_cdp as biz
import boss_tui as tui


class FakeTerminal(io.StringIO):
    """可注入的假终端：有 columns/rows，让 TUI 帧布局与真实终端一致。"""
    columns = 100
    rows = 24


def new_app():
    ctx = tui.Ctx()
    pages = [tui.OverviewPage(ctx), tui.ConfigPage(ctx), tui.LogPage(ctx), tui.ResultsPage(ctx)]
    app = tui.TuiApp("BOSS直聘采集工具", pages, output=FakeTerminal(),
                     status_bar_provider=lambda a: tui.build_status_lines(ctx, a))
    return ctx, pages, app


# ---------------------------------------------------------------- 业务真源

class BusinessTests(unittest.TestCase):
    def test_response_job_list_supports_current_nested_shape(self):
        data = {"code": 0, "zpData": {"resCount": 1, "jobList": [{"jobId": "J1"}]}}
        self.assertEqual(biz.response_job_list(data), [{"jobId": "J1"}])

    def test_response_job_list_prefers_current_shape_over_empty_legacy_field(self):
        data = {
            "code": 0,
            "zpList": [],
            "zpData": {"jobList": [{"jobId": "CURRENT"}]},
        }
        self.assertEqual(biz.response_job_list(data), [{"jobId": "CURRENT"}])

    def test_cdp_recv_event_honors_short_timeout(self):
        class FakeWebSocket:
            def __init__(self):
                self.timeout = 60

            def gettimeout(self):
                return self.timeout

            def settimeout(self, value):
                self.timeout = value

            def recv(self):
                raise WebSocketTimeoutException()

        session = biz.CDPSession.__new__(biz.CDPSession)
        session.ws = FakeWebSocket()
        session._pending = {}
        started = time.monotonic()
        self.assertIsNone(session.recv_event(timeout=0.05))
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(session.ws.gettimeout(), 60)

    def test_cdp_wait_response_uses_cached_response(self):
        session = biz.CDPSession.__new__(biz.CDPSession)
        session._pending = {7: {"id": 7, "result": {"ok": True}}}
        self.assertEqual(session.wait_response(7, timeout=0.01)["id"], 7)
        self.assertNotIn(7, session._pending)

    def test_parse_job(self):
        item = {
            "jobId": "J1", "encryptJobId": "eJ1", "jobName": "国内电商运营",
            "salaryDesc": "6-11K", "cityName": "深圳", "areaDistrict": "龙岗区",
            "businessDistrict": "南联", "brandName": "深圳市锦祥桄仓库贸易",
            "bossName": "张三", "bossTitle": "HR", "jobLabels": ["五险一金"], "skills": ["电商"],
        }
        row = biz.parse_job(item)
        self.assertEqual(row["company"], "深圳市锦祥桄仓库贸易")
        self.assertEqual(row["title"], "国内电商运营")
        self.assertEqual(row["salary"], "6-11K")
        self.assertEqual(row["location"], "深圳·龙岗区·南联")
        self.assertEqual(row["job_link"], "https://www.zhipin.com/job_detail/eJ1.html")

    def test_parse_job_normalizes_non_string_fields(self):
        row = biz.parse_job({
            "jobId": 123, "jobName": "运营", "cityName": 101,
            "jobLabels": ["经验不限", 3], "skills": "办公软件",
        })
        self.assertEqual(row["job_id"], "123")
        self.assertEqual(row["location"], "101")
        self.assertEqual(row["tags"], "经验不限,3")
        self.assertEqual(row["skills"], "办公软件")

    def test_export_csv_real_file(self):
        """真实生成 CSV 文件并读回校验：UTF-8 BOM、表头、中文内容、全列对齐。"""
        row = biz.parse_job({"jobId": "J1", "encryptJobId": "eJ1", "jobName": "运营",
                             "salaryDesc": "6-11K", "cityName": "深圳", "brandName": "某公司"})
        with tempfile.TemporaryDirectory() as d:
            paths = biz.export_rows([row], "kw", "101280600", "csv", d)
            self.assertTrue(os.path.exists(paths["csv"]))
            raw = open(paths["csv"], "rb").read()
            self.assertTrue(raw.startswith(b"\xef\xbb\xbf"), "CSV 必须带 UTF-8 BOM（Excel 打开不乱码）")
            raw.decode("utf-8")  # 乱码自检：整文件可 UTF-8 解码
            with open(paths["csv"], "r", encoding="utf-8-sig", newline="") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(rows[0]["company"], "某公司")
            self.assertEqual(rows[0]["location"], "深圳")

    def test_export_json_real_file(self):
        with tempfile.TemporaryDirectory() as d:
            paths = biz.export_rows([{"company": "甲"}], "kw", "101280600", "json", d)
            data = json.load(open(paths["json"], encoding="utf-8"))
            self.assertEqual(data[0]["company"], "甲")

    def test_export_names_do_not_overwrite_same_second(self):
        with tempfile.TemporaryDirectory() as d:
            first = biz.export_rows([], "kw", "101280600", "csv", d)["csv"]
            second = biz.export_rows([], "kw", "101280600", "csv", d)["csv"]
            self.assertNotEqual(first, second)
            self.assertTrue(os.path.exists(first))
            self.assertTrue(os.path.exists(second))

    def test_login_state_accepts_edge_network_cookie_location(self):
        """Edge 127+ 的 Cookie 数据位于 Default/Network/Cookies。"""
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "Default", "Network"), exist_ok=True)
            open(os.path.join(d, "Default", "Network", "Cookies"), "wb").close()
            with mock.patch.object(biz, "PROFILE_DIR", d):
                self.assertTrue(tui.is_logged_in())

    def test_login_wait_accepts_logged_in_empty_job_list(self):
        """登录有效不应依赖岗位数量；空列表也必须视为已登录。"""
        class FakeSession:
            def __init__(self):
                self.navigate_urls = []
                self.closed = False

            def send(self, method, params=None):
                if method == "Page.navigate":
                    self.navigate_urls.append(params["url"])
                return 1

            def close(self):
                self.closed = True

        fake = FakeSession()
        clock = [0.0]

        def fake_wait(_session, timeout=60, **_kwargs):
            clock[0] += 2.0
            return {"code": 0, "zpList": []}

        with mock.patch.object(biz, "_new_session", return_value=fake), \
             mock.patch.object(biz, "_await_joblist", side_effect=fake_wait), \
             mock.patch.object(biz.time, "time", side_effect=lambda: clock[0]):
            result = biz.login_wait("国内电商", "101280600", port=9222, login_timeout=1)

        self.assertTrue(result)
        self.assertEqual(len(fake.navigate_urls), 1)
        self.assertTrue(fake.closed)

    def test_close_owned_edge_uses_process_tree_and_is_idempotent(self):
        """退出只清理本次登记的 Edge，重复清理不应误伤其他实例。"""
        fake_process = type("FakeProcess", (), {"pid": 4321})()
        with mock.patch.object(biz, "_owned_edge_processes", {9222: fake_process}), \
             mock.patch.object(biz, "_close_browser_via_cdp", return_value=False), \
             mock.patch.object(biz, "_wait_for_cdp_closed", return_value=False), \
             mock.patch.object(biz, "_terminate_process_tree") as terminate:
            self.assertTrue(biz.close_owned_edge(9222))
            terminate.assert_called_once_with(4321)
            self.assertFalse(biz.close_owned_edge(9222))

    def test_close_owned_edge_prefers_cdp_browser_close(self):
        """优先按 CDP 端口关闭真实 Edge；成功时不等待或强杀。"""
        fake_process = type("FakeProcess", (), {"pid": 4321})()
        with mock.patch.object(biz, "_owned_edge_processes", {9223: fake_process}), \
             mock.patch.object(biz, "_close_browser_via_cdp", return_value=True) as close_cdp, \
             mock.patch.object(biz, "_wait_for_cdp_closed", return_value=True), \
             mock.patch.object(biz, "_terminate_process_tree") as terminate:
            self.assertTrue(biz.close_owned_edge(9223))
        close_cdp.assert_called_once_with(9223)
        terminate.assert_not_called()

    def test_login_wait_does_not_renavigate_while_waiting_for_manual_login(self):
        """未登录时浏览器页面只能导航一次，后续必须停留等待用户登录。"""
        class FakeSession:
            def __init__(self):
                self.navigate_urls = []
                self.closed = False

            def send(self, method, params=None):
                if method == "Page.navigate":
                    self.navigate_urls.append(params["url"])
                return 1

            def close(self):
                self.closed = True

        fake = FakeSession()
        clock = [0.0]

        def fake_wait(_session, timeout=60, **_kwargs):
            clock[0] += 1.0
            return None  # 模拟登录页没有岗位请求，用户尚未登录

        with mock.patch.object(biz, "_new_session", return_value=fake), \
             mock.patch.object(biz, "_await_joblist", side_effect=fake_wait), \
             mock.patch.object(biz.time, "time", side_effect=lambda: clock[0]):
            result = biz.login_wait("国内电商", "101280600", port=9222, login_timeout=5)

        self.assertFalse(result)
        self.assertEqual(len(fake.navigate_urls), 1,
                         "未登录等待期间不得重复 Page.navigate，页面必须停留给用户扫码")
        self.assertTrue(fake.closed)

    def test_search_url_encoding(self):
        url = biz.search_url("国内电商", "101280600", 2)
        self.assertIn("query=%E5%9B%BD%E5%86%85%E7%94%B5%E5%95%86", url)
        self.assertIn("city=101280600", url)
        self.assertIn("page=2", url)

    def test_fetch_page_skips_delay_after_final_page(self):
        class FakeSession:
            def send(self, method, params=None):
                return 1

        with mock.patch.object(biz, "_await_joblist", return_value={"code": 0, "zpList": []}), \
             mock.patch.object(biz.time, "sleep") as sleep:
            self.assertEqual(biz.fetch_page(FakeSession(), "运营", "101280600", 1,
                                            page_delay=3, total_pages=1), [])
        sleep.assert_not_called()

    def test_run_fetch_rejects_invalid_inputs_before_edge(self):
        with mock.patch.object(biz, "ensure_edge_running") as ensure:
            with self.assertRaises(ValueError):
                biz.run_fetch("", "深圳", 1, "csv", 0, 9222)
            ensure.assert_not_called()

    def test_cli_setup_returns_failure_exit_code(self):
        with mock.patch.object(biz, "ensure_edge_running"), \
             mock.patch.object(biz, "login_wait", return_value=False), \
             mock.patch.object(biz, "close_owned_edge"):
            with mock.patch.object(sys, "argv", ["boss_cdp.py", "setup", "--login-timeout", "1"]):
                with self.assertRaises(SystemExit) as raised:
                    biz.main()
        self.assertEqual(raised.exception.code, 2)

    def test_run_fetch_normalizes_string_page_count(self):
        class FakeSession:
            def __init__(self):
                self.closed = False

            def send(self, method, params=None):
                return 1

            def close(self):
                self.closed = True

        fake = FakeSession()
        seen_pages = []

        def fake_fetch_page(session, keyword, city_code, page, delay, total_pages=0, progress=None):
            seen_pages.append((page, total_pages))
            return []

        with mock.patch.object(biz, "ensure_edge_running"), \
             mock.patch.object(biz, "_new_session", return_value=fake), \
             mock.patch.object(biz, "fetch_page", side_effect=fake_fetch_page), \
             mock.patch.object(biz, "export_rows", return_value={}):
            result = biz.run_fetch("国内电商", "深圳", "2", "csv", 0, 9222)

        self.assertEqual(result, [])
        self.assertEqual(seen_pages, [(1, 2), (2, 2)])
        self.assertTrue(fake.closed)

    def test_run_fetch_success_log_contains_time_and_celebration(self):
        class FakeSession:
            def send(self, method, params=None):
                return 1

            def close(self):
                pass

        with mock.patch.object(biz, "ensure_edge_running"), \
             mock.patch.object(biz, "_new_session", return_value=FakeSession()), \
             mock.patch.object(biz, "fetch_page", return_value=[]), \
             mock.patch.object(biz, "export_rows", return_value={}):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                biz.run_fetch("国内电商", "深圳", 1, "csv", 0, 9222)

        text = output.getvalue()
        self.assertIn("🎉 [fetch] 抓取成功", text)
        self.assertRegex(text, r"20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")

    def test_city_codes_known(self):
        for city in ("深圳", "北京", "上海", "广州", "杭州"):
            self.assertTrue(str(biz.CITY_CODES[city]).isdigit())

    def test_edge_launch_uses_only_edge_candidate(self):
        class FakeProcess:
            def __init__(self):
                self.pid = 4321

            def poll(self):
                return None

        edge_path = biz.EDGE_CANDIDATES[0]
        with mock.patch.object(biz.os.path, "exists", side_effect=lambda path: path == edge_path), \
             mock.patch.object(biz.subprocess, "Popen", return_value=FakeProcess()) as popen, \
             mock.patch.object(biz, "cdp_ready", side_effect=[False, True]), \
             mock.patch.object(biz.time, "sleep"):
            self.assertTrue(biz.ensure_edge_running(9222))

        self.assertEqual(popen.call_args.args[0][0], edge_path)


# ---------------------------------------------------------------- TUI（无头真实渲染）

class TuiTests(unittest.TestCase):
    def _frame(self, app):
        return app.build_frame()

    def test_overview_login_action_moves_to_bottom_when_logged_in(self):
        _, pages, _ = new_app()
        with mock.patch.object(tui, "is_logged_in", return_value=False):
            labels = [item[0] for item in pages[0].items]
            self.assertIn("首次登录", labels[0])
            self.assertIn("检查", labels[0])
            self.assertEqual(labels[1], "开始抓取")
            self.assertEqual(labels[-1], "退出采集工具")
        with mock.patch.object(tui, "is_logged_in", return_value=True):
            labels = [item[0] for item in pages[0].items]
            self.assertEqual(labels[0], "开始抓取")
            self.assertIn("首次登录", labels[-1])
            rendered = "\n".join(pages[0].render(type("App", (), {"columns": 100, "content_height": 15})()))
            self.assertIn(tui.CODES["brightGreen"], rendered)
            self.assertIn(tui.CODES["brightRed"], rendered)
        self.assertEqual(pages[1].title, "配置")
        self.assertNotIn("开始抓取", [field["label"] for field in pages[1].fields])

    def test_frame_structure_and_no_mojibake(self):
        """四页全部渲染：行数=终端行数、版权两行、无乱码（U+FFFD/非法解码）、每行不超宽过多。"""
        for idx in range(4):
            with self.subTest(page=idx + 1):
                _, _, app = new_app()
                app.switch_page(idx)
                frame = self._frame(app)
                self.assertEqual(len(frame), 24, "帧行数必须等于终端行数")
                self.assertIn("作者：黎路遥", frame[20])
                self.assertIn("版权所有 © 黎路遥", frame[21])
                for line in frame:
                    line.encode("utf-8").decode("utf-8")  # 合法 UTF-8
                    self.assertNotIn("\ufffd", line, "出现替换符=乱码")
                    w = tui.display_width(line)
                    self.assertLessEqual(w, 102, f"行宽越界: {w}")
                # 菜单栏含四页
                self.assertTrue(all(t in frame[3] for t in ("1首页", "2配置", "3日志", "4结果")))

    def test_dispatch_global_keys(self):
        ctx, pages, app = new_app()
        app.dispatch_key("right")
        self.assertEqual(app.current_page_index, 1)
        app.dispatch_key("3")
        self.assertEqual(app.current_page_index, 2)
        # Ctrl+C 与退出菜单：直接退出，不再要确认
        calls = []
        app.on_exit_request = lambda: calls.append("exit")
        app.dispatch_key("ctrl-c")
        self.assertEqual(calls, ["exit"])
        pages[0].handle_key("up", app)  # 回到退出项
        app.switch_page(0)
        with mock.patch.object(tui, "is_logged_in", return_value=False):
            pages[0].state["selection"] = len(pages[0].items) - 1
            pages[0].handle_key("enter", app)
        self.assertEqual(calls, ["exit", "exit"])
        app.switch_page(0)
        pages[0].handle_key("0", app)
        self.assertEqual(calls, ["exit", "exit", "exit"])
        app.dispatch_key("q")
        self.assertEqual(app.current_page_index, 0)

    def test_windows_escape_does_not_swallow_following_text(self):
        """Windows 单独按 Esc 后，后续关键词字符仍应正常进入编辑器。"""
        class FakeMsvcrt:
            def __init__(self, chars):
                self.chars = list(chars)

            def kbhit(self):
                return bool(self.chars)

            def getwch(self):
                return self.chars.pop(0)

        app = tui.TuiApp("test", [], output=FakeTerminal())
        reader = FakeMsvcrt([chr(27), "a", "b"])
        self.assertEqual(app._read_windows_key(reader), "esc")
        self.assertEqual(app._read_windows_key(reader), "a")
        self.assertEqual(app._read_windows_key(reader), "b")

    def test_home_start_fetch_uses_config(self):
        ctx, pages, app = new_app()
        ctx.config.update(keyword="运营", city="北京", pages=2, format="json")
        with mock.patch.object(biz, "run_fetch", return_value=[]), \
             mock.patch.object(tui, "is_logged_in", return_value=True):
            app.switch_page(0)
            pages[0].state["selection"] = next(
                index for index, item in enumerate(pages[0].items) if item[0] == "开始抓取"
            )
            pages[0].handle_key("enter", app)
            while ctx.tasks.running:
                time.sleep(0.01)
        self.assertEqual(ctx.tasks.task["desc"], "抓取 运营 @ 北京")
        self.assertEqual(app.current_page_index, 2)

    def test_config_text_left_right_do_not_start_editing(self):
        _, pages, app = new_app()
        app.switch_page(1)
        config = pages[1]
        config.state["selection"] = 0
        self.assertIsNone(config.handle_key("right", app))
        self.assertIsNone(config.state["editing"])
        self.assertIsNone(config.handle_key("left", app))
        self.assertIsNone(config.state["editing"])

    def test_config_keyword_edit(self):
        _, pages, app = new_app()
        app.switch_page(1)
        config = pages[1]
        config.state["selection"] = 0
        config.handle_key("enter", app)
        for _ in config.state["edit_buffer"]:
            config.handle_key("backspace", app)
        for ch in "运营":
            config.handle_key(ch, app)
        config.handle_key("enter", app)
        self.assertEqual(config.ctx.config["keyword"], "运营")
        self.assertIsNone(config.state["editing"])

    def test_config_form_edit(self):
        _, pages, app = new_app()
        config = pages[1]
        config.handle_key("down", app)
        config.handle_key("enter", app)
        self.assertIsNotNone(config.state["editing"])
        for _ in config.state["edit_buffer"]:
            config.handle_key("backspace", app)
        for ch in "北京":
            config.handle_key(ch, app)
        config.handle_key("enter", app)
        self.assertEqual(config.ctx.config["city"], "北京")
        # 所有设置都必须先回车进入编辑，再由左右键调整，最后回车保存。
        config.state["selection"] = 2
        config.handle_key("right", app)
        self.assertEqual(config.ctx.config["pages"], 1)
        config.handle_key("enter", app)
        config.handle_key("right", app)
        self.assertEqual(config.ctx.config["pages"], 1)
        config.handle_key("enter", app)
        self.assertEqual(config.ctx.config["pages"], 2)
        config.state["selection"] = 3
        config.handle_key("enter", app)
        config.handle_key("right", app)
        self.assertEqual(config.ctx.config["format"], "csv")
        config.handle_key("enter", app)
        self.assertEqual(config.ctx.config["format"], "json")

    def test_config_edit_escape_discards_all_field_types(self):
        _, pages, app = new_app()
        config = pages[1]
        original = dict(config.ctx.config)
        for index, key in ((0, "keyword"), (2, "pages"), (3, "format")):
            config.state["selection"] = index
            config.handle_key("enter", app)
            if key == "keyword":
                config.handle_key("x", app)
            else:
                config.handle_key("right", app)
            config.handle_key("esc", app)
        self.assertEqual(config.ctx.config, original)

    def test_ctx_cleanup_is_idempotent(self):
        """TUI 退出与 finally 可能各调用一次，资源清理必须只执行一次。"""
        ctx = tui.Ctx()
        with mock.patch.object(biz, "close_owned_edge", return_value=True) as close:
            ctx.cleanup()
            ctx.cleanup()
        close.assert_called_once_with()

    def test_task_runner_captures_real_stdout(self):
        ctx = tui.Ctx()
        runner = ctx.tasks

        def job():
            print("real-log-line-中文")
            time.sleep(0.05)
            return [1, 2, 3]

        self.assertTrue(runner.start("t", job))
        self.assertTrue(runner.running)
        self.assertFalse(runner.start("t2", lambda: None), "运行中不得重复启动")
        while runner.running:
            time.sleep(0.02)
        self.assertEqual(runner.task["result"], [1, 2, 3])
        self.assertIn("real-log-line-中文", runner.snapshot_lines())

    def test_task_runner_reports_progress_for_bar_and_stage(self):
        ctx = tui.Ctx()
        runner = ctx.tasks

        def job(progress=None):
            progress(1, 3, "第 1/3 页", "正在等待接口响应")
            time.sleep(0.05)
            return [1]

        self.assertTrue(runner.start("抓取测试", job, with_progress=True, total=3))
        time.sleep(0.01)
        self.assertEqual(runner.task["total"], 3)
        self.assertEqual(runner.task["current"], 1)
        self.assertEqual(runner.task["stage"], "第 1/3 页")
        self.assertIn("▰", tui.format_progress_bar(1, 3))
        self.assertIn(tui.spinner_frame(), "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏")
        while runner.running:
            time.sleep(0.02)

    def test_log_page_shows_progress_and_wait_animation(self):
        ctx, pages, app = new_app()

        def job(progress=None):
            progress(1, 3, "等待第 2/3 页响应", "已等待 2s")
            time.sleep(0.05)

        ctx.tasks.start("抓取测试", job, with_progress=True, total=3)
        for _ in range(20):
            if ctx.tasks.task["current"] == 1:
                break
            time.sleep(0.01)
        rendered = "\\n".join(pages[2].render(app))
        self.assertIn("等待第 2/3 页响应", rendered)
        self.assertIn("已等待 2s", rendered)
        self.assertIn("▰", rendered)
        self.assertIn(tui.spinner_frame(), "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏")
        while ctx.tasks.running:
            time.sleep(0.02)

    def test_task_runner_error_reported(self):
        ctx = tui.Ctx()
        runner = ctx.tasks

        def boom():
            raise RuntimeError("真实异常必须被捕获")

        runner.start("boom", boom)
        while runner.running:
            time.sleep(0.02)
        self.assertIsNotNone(runner.task["error"])

    def test_non_tty_start_renders_and_exits(self):
        """无头启动（自动化/AI 调用）不阻塞、不崩溃，输出一帧即返回。"""
        ctx, pages, app = new_app()
        try:
            app.start()
        finally:
            app.stop()
        output = app.output.getvalue()
        self.assertIn("首页", output)
        self.assertIn("黎路遥", output)


# ---------------------------------------------------------------- 真实 Edge（可选）

@unittest.skipUnless("--with-edge" in sys.argv, "需 --with-edge 才启动真实 Edge")
class EdgeTests(unittest.TestCase):
    def test_edge_launch_and_cdp(self):
        self.assertTrue(biz.find_edge(), "应能找到 Edge")
        active_port = biz.ensure_edge_running(biz.DEFAULT_PORT)
        started = active_port in biz._owned_edge_processes
        self.assertTrue(started or biz.cdp_ready(active_port))
        self.assertTrue(biz.cdp_ready(active_port), "CDP 端口应可访问")
        info = biz.open_tab(active_port)
        self.assertTrue(info.startswith("ws://"), "应拿到 WebSocket 调试地址")
        # 真正建立 WebSocket 并执行 CDP 请求，不只检查地址字符串。
        sess = biz.CDPSession(info)
        request_id = sess.send("Browser.getVersion")
        response = sess.wait_response(request_id, timeout=10)
        self.assertIsNotNone(response, "CDP WebSocket 应返回响应")
        self.assertIn("result", response, "CDP 响应应包含 result")
        sess.close()
        # 只清理本测试实际启动的 Edge；测试前已有实例绝不触碰。
        if started:
            self.assertTrue(biz.close_owned_edge(active_port))
            for _ in range(20):
                if not biz.cdp_ready(active_port):
                    break
                time.sleep(0.1)
            self.assertFalse(biz.cdp_ready(active_port), "测试启动的 Edge 应已被进程树清理")

    def test_login_state_detection(self):
        # 真实判断登录态（读专用 profile 目录）
        logged = tui.is_logged_in()
        print(f"\n[info] 登录态检测：{'已登录' if logged else '未登录（需先扫码一次）'}")


# ---------------------------------------------------------------- 真实抓取（可选，需已登录）

@unittest.skipUnless("--with-real-fetch" in sys.argv and any(os.path.exists(path) for path in (
    os.path.join(biz.PROFILE_DIR, "Default", "Network", "Cookies"),
    os.path.join(biz.PROFILE_DIR, "Default", "Cookies"),
)), "需 --with-real-fetch 且已扫码登录")
class RealFetchTests(unittest.TestCase):
    def test_real_fetch_one_page(self):
        """真实浏览器 + 真实网络 + 真实导出文件，验证完整抓取链路。"""
        before = set(os.listdir(biz.RESULT_DIR)) if os.path.isdir(biz.RESULT_DIR) else set()
        try:
            rows = biz.run_fetch("国内电商", "深圳", 1, "both", delay=0, port=biz.DEFAULT_PORT)
            self.assertGreater(len(rows), 0, "应抓取到至少一条真实岗位数据")
            for key in ("company", "title", "salary", "job_link"):
                self.assertTrue(rows[0][key], f"字段 {key} 不应为空")
            after = set(os.listdir(biz.RESULT_DIR))
            new_files = after - before
            self.assertTrue(any(f.endswith(".csv") for f in new_files), "应生成真实 CSV 导出文件")
            # 读回校验
            for f in new_files:
                if f.endswith(".csv"):
                    with open(os.path.join(biz.RESULT_DIR, f), encoding="utf-8-sig") as fh:
                        content = fh.read()
                    self.assertIn(rows[0]["company"], content, "CSV 内容应含抓到的公司名")
        finally:
            # 真实测试只清理本测试自己启动的 Edge，不碰测试前已有实例。
            biz.close_owned_edge()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="16号项目自动化自检")
    ap.add_argument("--with-edge", action="store_true", help="追加：真实启动 Edge 并探测 CDP")
    ap.add_argument("--with-real-fetch", action="store_true", help="追加：真实网络抓 1 页（需已登录）")
    args, rest = ap.parse_known_args()
    if args.with_edge:
        sys.argv.append("--with-edge")
    if args.with_real_fetch:
        sys.argv.append("--with-real-fetch")
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    print("\n[summary] PASS/FAIL/SKIP:",
          result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped),
          len(result.failures) + len(result.errors), result.skipped.__len__())
    sys.exit(0 if result.wasSuccessful() else 1)
