"""可靠性回归：真实业务/传输/文件/线程代码，浏览器和网站消息由隔离夹具替代。
不连接网站、不启动 Edge；Windows/真实验证必须另行实机验收。
"""
from collections import deque
import contextlib
import csv
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest import mock
from urllib.parse import urlencode, urlsplit, parse_qs

from websocket import WebSocketTimeoutException
import boss_cdp as biz
import boss_storage as storage
import boss_terminal as terminal
import boss_transport as transport
import boss_tui as tui
from boss_types import (FetchResult, FetchError, FetchCancelled, ProtocolError,
                        ResponseSchemaError, SiteResponseError, VerificationRequired)
from task_runtime import TaskRunner


def data(rows=None, more=False, code=0):
    return {"code": code, "message": "您的环境存在异常" if code == 37 else "",
            "zpData": {"jobList": rows if rows is not None else [], "hasMore": more}}


def item(job_id="J1", company="测试企业有限公司"):
    return {"jobId": job_id, "jobName": "国内电商客服", "companyName": company, "brandName": "测试品牌"}


def network_events(request_id="R1", page=1, keyword="国内电商", city="101280600", status=200):
    url = "https://www.zhipin.com" + transport.JOBLIST_PATH_PART + "?" + urlencode({"page": page, "query": keyword, "city": city})
    return [{"method": "Network.requestWillBeSent", "params": {"requestId": request_id, "request": {"url": url}}},
            {"method": "Network.responseReceived", "params": {"requestId": request_id, "response": {"url": url, "status": status}}},
            {"method": "Network.loadingFinished", "params": {"requestId": request_id}}]


class FakeSocket:
    def __init__(self, payloads=None, events=()):
        self.messages = deque(events)
        self.commands = []
        self.bodies = {}
        self.payloads = deque(payloads or [])
        self.timeout = 60
        self.closed = False
        self.counter = 0

    def gettimeout(self):
        return self.timeout

    def settimeout(self, value):
        self.timeout = value

    def send(self, raw):
        command = json.loads(raw)
        self.commands.append(command)
        method, params = command["method"], command.get("params", {})
        result = {}
        if method == "Page.navigate" and "/web/geek/job" in params.get("url", ""):
            query = parse_qs(urlsplit(params["url"]).query)
            self.emit_page(self.payloads.popleft(), 1, query["query"][0], query["city"][0])
        elif method == "Runtime.evaluate" and "scrollTo" in params.get("expression", ""):
            self.emit_page(self.payloads.popleft(), self.counter + 1)
        elif method == "Network.getResponseBody":
            body = self.bodies[params["requestId"]]
            result = {"body": body if isinstance(body, str) else json.dumps(body), "base64Encoded": False}
        self.messages.append({"id": command["id"], "result": result})

    def emit_page(self, payload, page=1, keyword="国内电商", city="101280600"):
        self.counter += 1
        request_id = f"R{self.counter}"
        self.bodies[request_id] = payload
        self.messages.extend(network_events(request_id, page, keyword, city))

    def recv(self):
        if not self.messages:
            raise WebSocketTimeoutException()
        message = self.messages.popleft()
        return json.dumps(message) if isinstance(message, dict) else message

    def close(self):
        self.closed = True


def session(socket):
    with mock.patch.object(transport, "create_connection", return_value=socket):
        return transport.CDPSession("ws://127.0.0.1:9222/devtools/page/test")


class ContractTests(unittest.TestCase):
    def test_empty_and_malformed_responses_are_different(self):
        self.assertEqual(biz.response_job_list(data()), [])
        for payload in (None, [], {}, {"zpData": {}}, {"jobList": None}, {"jobList": [None]}):
            with self.subTest(payload=payload), self.assertRaises(ResponseSchemaError):
                biz.response_job_list(payload)

    def test_nested_list_takes_precedence(self):
        self.assertEqual(biz.response_job_list({"zpData": {"jobList": []}, "zpList": [item()]}), [])
        self.assertEqual(biz.response_job_list({"zpList": [item()]}), [item()])

    def test_parameters_reject_silent_coercions(self):
        for value in (True, False, 1.9, "1.0", -1, "１２", 0, 1001):
            with self.subTest(value=value), self.assertRaises(ValueError):
                biz.normalize_page_count(value)
        self.assertEqual(biz.normalize_page_count(" 400 "), 400)
        self.assertEqual(biz.normalize_page_count(1000), 1000)

    def test_nonfinite_delay_is_rejected_before_browser_start(self):
        with mock.patch.object(biz, "ensure_edge_running") as start:
            for value in (float("nan"), float("inf"), -1, True):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    biz.run_fetch("国内电商", "深圳", 1, "csv", value, 9222)
            start.assert_not_called()

    def test_city_is_normalized_but_not_guessed(self):
        self.assertEqual(biz.normalize_city(" 郑州市 "), "郑州")
        with self.assertRaises(ValueError):
            biz.normalize_city("未知城市")

    def test_result_keeps_list_compatibility_and_truthful_exit_codes(self):
        for status, code in FetchResult.EXIT_CODES.items():
            result = FetchResult([{"company": "测试"}], status=status)
            self.assertIsInstance(result, list)
            self.assertEqual(result.exit_code, code)
        self.assertEqual(FetchResult(status="empty"), [])

    def test_company_parser_handles_colon_and_void_tags(self):
        html = '<li class="company-name"><span>公司名称：</span>测试<br/>企业有限公司</li>'
        self.assertEqual(biz.company_name_from_detail_html(html), "测试企业有限公司")
        self.assertEqual(biz.company_name_from_detail_html("只有品牌简称"), "")

    def test_brand_is_not_fabricated_into_full_company(self):
        row = biz.parse_job({"jobId": "1", "brandName": "某品牌"})
        self.assertEqual(row["company"], "")
        self.assertEqual(row["brand"], "某品牌")

    def test_detail_id_cannot_change_host_or_path_structure(self):
        url = biz.job_detail_url({"jobId": "../../security?token=x"})
        self.assertEqual(urlsplit(url).hostname, "www.zhipin.com")
        self.assertEqual(urlsplit(url).query, "")
        self.assertIn("%2F", url)


class TransportTests(unittest.TestCase):
    def test_body_is_not_read_before_loading_finished(self):
        ws = FakeSocket(events=network_events()[:2])
        current = session(ws)
        current.recv_event()
        current.recv_event()
        self.assertIsNone(current.pop_joblist())
        self.assertFalse(any(cmd["method"] == "Network.getResponseBody" for cmd in ws.commands))
        ws.messages.append(network_events()[2])
        current.recv_event()
        self.assertEqual(current.pop_joblist()["requestId"], "R1")

    def test_same_request_id_in_two_sessions_does_not_cross_contaminate(self):
        first, second = session(FakeSocket(events=network_events())), session(FakeSocket())
        for _ in range(3):
            first.recv_event()
        self.assertIsNone(second.pop_joblist())
        self.assertEqual(first.pop_joblist()["requestId"], "R1")

    def test_command_wait_preserves_document_events(self):
        event = {"method": "Network.loadingFinished", "params": {"requestId": "document"}}
        ws = FakeSocket(events=[event])
        current = session(ws)
        current.command("Network.enable")
        self.assertEqual(current.recv_event(), event)

    def test_prefetched_future_page_is_kept_until_expected(self):
        ws = FakeSocket(events=network_events("future", page=2))
        current = session(ws)
        current.expected_joblist = {"page": 1, "query": "国内电商", "city": "101280600"}
        for _ in range(3):
            current.recv_event()
        self.assertIsNone(current.pop_joblist())
        current.expected_joblist["page"] = 2
        self.assertEqual(current.pop_joblist()["requestId"], "future")

    def test_wrong_query_is_not_accepted_as_current_search(self):
        current = session(FakeSocket(events=network_events(keyword="别的关键词")))
        current.expected_joblist = {"page": 1, "query": "国内电商", "city": "101280600"}
        for _ in range(3):
            current.recv_event()
        self.assertIsNone(current.pop_joblist())

    def test_post_body_merges_with_url_query(self):
        event = network_events()[0]
        event["params"]["request"]["postData"] = "page=2"
        current = session(FakeSocket(events=[event]))
        current.recv_event()
        fields = current.joblist_requests["R1"]
        self.assertEqual(fields["page"], ["2"])
        self.assertEqual(fields["query"], ["国内电商"])

    def test_closed_connection_is_not_reported_as_empty_data(self):
        current = session(FakeSocket(events=[""]))
        with self.assertRaises(ConnectionError):
            current.recv_event()

    def test_command_error_is_reported(self):
        current = session(FakeSocket(events=[{"id": 1, "error": {"message": "拒绝命令"}}]))
        with self.assertRaises(ProtocolError):
            current.command("Network.enable")

    def test_body_parse_errors_are_not_zero_results(self):
        for body in ("<html>verify</html>", "null", '{"code": false}'):
            with self.subTest(body=body):
                ws = FakeSocket(events=network_events())
                ws.bodies["R1"] = body
                current = session(ws)
                for _ in range(3):
                    current.recv_event()
                with self.assertRaises(ResponseSchemaError):
                    biz._joblist_response_data(current, current.pop_joblist())

    def test_http_429_does_not_read_or_retry_body(self):
        ws = FakeSocket(events=network_events(status=429))
        current = session(ws)
        for _ in range(3):
            current.recv_event()
        with self.assertRaises(VerificationRequired):
            biz._joblist_response_data(current, current.pop_joblist())
        self.assertEqual(ws.commands, [])

    def test_loading_failure_is_not_silently_discarded(self):
        events = network_events()[:2] + [{"method": "Network.loadingFailed", "params": {"requestId": "R1", "errorText": "断网"}}]
        current = session(FakeSocket(events=events))
        for _ in range(3):
            current.recv_event()
        with self.assertRaises(ConnectionError):
            biz._joblist_response_data(current, current.pop_joblist())

    def test_command_cache_is_bounded(self):
        current = session(FakeSocket())
        for _ in range(transport.MAX_PENDING + 50):
            current.send("Page.bringToFront")
        self.assertLessEqual(len(current._pending), transport.MAX_PENDING)

    def test_stop_signal_interrupts_receive_and_close_still_works(self):
        token = threading.Event()
        current = session(FakeSocket())
        current.stop_event = token
        token.set()
        with self.assertRaises(FetchCancelled):
            current.recv_event()
        current.close()
        self.assertTrue(current.ws.closed)
        self.assertEqual([cmd["method"] for cmd in current.ws.commands], ["Page.close"])

    def test_preserved_page_is_not_closed(self):
        current = session(FakeSocket())
        current.keep_open = True
        current.close()
        current.close()
        self.assertEqual(current.ws.commands, [])
        self.assertTrue(current.ws.closed)

    def test_code_37_never_triggers_automatic_reload(self):
        current = session(FakeSocket())
        with mock.patch.object(biz, "_await_joblist", return_value=data(code=37)) as wait:
            with self.assertRaises(VerificationRequired):
                biz._search_response(current, 1, 1, None, None, 0)
        wait.assert_called_once()
        self.assertEqual(current.ws.commands, [])
        self.assertTrue(current.keep_open)

    def test_passive_verification_can_accept_a_matching_user_response(self):
        current = session(FakeSocket())
        with mock.patch.object(biz, "_await_joblist", side_effect=[data(code=37), data([item()])]):
            result = biz._search_response(current, 1, 1, None, None, 1)
        self.assertEqual(result["code"], 0)
        self.assertFalse(current.keep_open)
        self.assertEqual(current.ws.commands, [], "恢复响应代表人工操作，程序不能自行重发请求")

    def test_verification_timeout_keeps_page_open(self):
        current = session(FakeSocket())
        with mock.patch.object(biz, "_await_joblist", side_effect=[data(code=37), None]):
            with self.assertRaises(VerificationRequired):
                biz._search_response(current, 1, 1, None, None, 1)
        self.assertTrue(current.keep_open)
        self.assertEqual(current.ws.commands, [])


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="boss_store_中文_")
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def test_atomic_failure_preserves_previous_file(self):
        path = self.folder / "previous.json"
        path.write_text("old", encoding="utf-8")
        def fail(stream):
            stream.write("unfinished")
            raise OSError("磁盘模拟错误")
        with self.assertRaises(OSError):
            storage.atomic_write(path, fail)
        self.assertEqual(path.read_text(), "old")
        self.assertEqual(list(self.folder.iterdir()), [path])

    def test_csv_has_bom_and_does_not_execute_formula(self):
        row = biz.parse_job(item(company='=HYPERLINK("bad")'))
        paths = storage.export_rows([row], "关键词", "101280600", "both", self.folder)
        self.assertTrue(Path(paths["csv"]).read_bytes().startswith(b"\xef\xbb\xbf"))
        with open(paths["csv"], encoding="utf-8-sig", newline="") as stream:
            saved = list(csv.DictReader(stream))
        self.assertTrue(saved[0]["company"].startswith("'="))
        self.assertEqual(json.loads(Path(paths["json"]).read_text())[0]["company"], row["company"])

    def test_repeated_exports_do_not_overwrite_each_other(self):
        first = storage.export_rows([biz.parse_job(item("1"))], "a/b", "101280600", "csv", self.folder)
        second = storage.export_rows([biz.parse_job(item("2"))], "a/b", "101280600", "csv", self.folder)
        self.assertNotEqual(first, second)
        self.assertEqual(len(list(self.folder.glob("*.csv"))), 2)

    def test_json_failure_retains_csv_and_reports_its_path(self):
        original = storage.atomic_write
        def write(path, writer, encoding="utf-8"):
            if str(path).endswith(".json"):
                raise OSError("JSON失败")
            return original(path, writer, encoding)
        with mock.patch.object(storage, "atomic_write", side_effect=write):
            with self.assertRaises(OSError) as raised:
                storage.export_rows([biz.parse_job(item())], "x", "101280600", "both", self.folder)
        self.assertTrue(Path(raised.exception.paths["csv"]).is_file())

    def test_checkpoint_recovers_pages_before_truncated_unicode_tail(self):
        store = storage.CheckpointStore(self.folder, "国内电商", "101280600", 400)
        store.write_page(1, [{"company": "真实已保存数据"}])
        path = store.path
        store.close()
        with open(path, "ab") as stream:
            stream.write(b'{"page":2,"rows":[{"company":"\xe6\xb5')
        rows, header = storage.recover_checkpoint(path)
        self.assertEqual(rows, [{"company": "真实已保存数据"}])
        self.assertEqual(header["requested_pages"], 400)

    def test_corrupt_complete_checkpoint_record_is_not_ignored(self):
        path = self.folder / "bad.jsonl"
        path.write_text('{"version":1}\nnot-json\n', encoding="utf-8")
        with self.assertRaises(ValueError):
            storage.recover_checkpoint(path)

    def test_duplicate_page_in_checkpoint_is_rejected(self):
        store = storage.CheckpointStore(self.folder, "x", "101280600", 2)
        store.write_page(1, [])
        store.write_page(1, [])
        store.close()
        with self.assertRaises(ValueError):
            storage.recover_checkpoint(store.path)

    def test_export_path_cannot_escape_directory(self):
        paths = storage.export_rows([], "../../name", "../../city", "json", self.folder)
        self.assertEqual(Path(paths["json"]).parent, self.folder)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="boss_flow_")
        self.addCleanup(self.temp.cleanup)
        self.output = io.StringIO()
        self.capture = contextlib.redirect_stdout(self.output)
        self.capture.__enter__()
        self.addCleanup(self.capture.__exit__, None, None, None)
        self.addCleanup(biz._owned_edge_processes.clear)

    def run_case(self, payloads, pages=1, **kwargs):
        search_socket, detail_socket = FakeSocket(payloads), FakeSocket()
        self.search, self.detail = session(search_socket), session(detail_socket)
        with mock.patch.object(biz, "ensure_edge_running", return_value=9222), \
             mock.patch.object(biz, "_new_session", side_effect=[self.search, self.detail]):
            return biz.run_fetch("国内电商", "深圳", pages, "csv", 0, 9222, outdir=self.temp.name, **kwargs)

    def test_full_pipeline_uses_single_navigation_and_real_files(self):
        result = self.run_case([data([item()])], pages=400)
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.completed_pages, 1)
        self.assertEqual(result.requested_pages, 400)
        methods = [cmd["method"] for cmd in self.search.ws.commands]
        self.assertEqual(methods.count("Page.navigate"), 1)
        self.assertLess(methods.index("Network.enable"), methods.index("Page.navigate"))
        self.assertEqual(storage.recover_checkpoint(result.checkpoint)[0], list(result))
        self.assertTrue(Path(result.paths["csv"]).is_file())
        self.assertTrue(self.search.ws.closed and self.detail.ws.closed)

    def test_empty_search_is_not_an_export_success(self):
        result = self.run_case([data()])
        self.assertEqual(result.status, "empty")
        self.assertEqual(result.paths, {})
        self.assertEqual(list(Path(self.temp.name).glob("*.csv")), [])

    def test_first_page_block_is_non_success_and_preserves_browser(self):
        with mock.patch.object(biz, "preserve_owned_edge") as preserve:
            with self.assertRaises(VerificationRequired) as raised:
                self.run_case([data(code=37)])
        preserve.assert_called_once_with(9222)
        self.assertEqual(raised.exception.result.status, "blocked")
        self.assertEqual(raised.exception.result.exit_code, 3)
        self.assertFalse(any(cmd["method"] == "Page.close" for cmd in self.search.ws.commands))
        self.assertEqual(list(Path(self.temp.name).glob("*.csv")), [])

    def test_later_block_keeps_previous_pages_and_nonzero_status(self):
        result = self.run_case([data([item()], more=True), data(code=37)], pages=400)
        self.assertEqual(result.status, "blocked")
        self.assertEqual(len(result), 1)
        self.assertEqual(result.exit_code, 3)
        self.assertEqual(result.failed_pages, [2])
        self.assertEqual(storage.recover_checkpoint(result.checkpoint)[0], list(result))
        self.assertTrue(Path(result.paths["csv"]).is_file())

    def test_later_schema_failure_is_partial_not_success(self):
        result = self.run_case([data([item()], more=True), {"code": 0}], pages=2)
        self.assertEqual(result.status, "partial")
        self.assertEqual(result.exit_code, 2)
        self.assertEqual(result.completed_pages, 1)

    def test_duplicate_page_stops_without_claiming_all_data(self):
        result = self.run_case([data([item()], more=True), data([item()], more=True)], pages=400)
        self.assertEqual(len(result), 1)
        self.assertEqual(result.status, "partial")
        self.assertEqual(result.completed_pages, 2)

    def test_cancel_before_start_does_not_open_browser(self):
        token = threading.Event()
        token.set()
        with mock.patch.object(biz, "ensure_edge_running") as start:
            result = biz.run_fetch("x", "深圳", 1, "csv", 0, 9222, stop_event=token, outdir=self.temp.name)
        start.assert_not_called()
        self.assertEqual(result.exit_code, 130)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_detail_cancellation_keeps_all_received_list_rows(self):
        token = threading.Event()
        items = [item("1", ""), item("2", ""), item("3", "")]
        def company(*args, **kwargs):
            token.set()
            return "已取得的企业全称"
        with mock.patch.object(biz, "fetch_company_full_name", side_effect=company):
            result = self.run_case([data(items)], stop_event=token)
        self.assertEqual(result.status, "cancelled")
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["company"], "已取得的企业全称")
        self.assertEqual(result[1]["company"], "")
        self.assertEqual(storage.recover_checkpoint(result.checkpoint)[0], list(result))

    def test_detail_security_failure_stops_rest_of_requests(self):
        error = VerificationRequired(37, "详情验证")
        with mock.patch.object(biz, "fetch_company_full_name", side_effect=error) as fetch:
            result = self.run_case([data([item("1", ""), item("2", "")])])
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(result.status, "blocked")
        self.assertEqual(len(result), 2)

    def test_three_detail_failures_open_circuit_and_keep_rows(self):
        with mock.patch.object(biz, "fetch_company_full_name", side_effect=ValueError("未披露")) as fetch, \
             mock.patch.object(biz, "COMPANY_DETAIL_INTERVAL", 0):
            result = self.run_case([data([item(str(n), "") for n in range(5)])])
        self.assertEqual(fetch.call_count, 3)
        self.assertEqual(result.status, "partial")
        self.assertEqual(len(result), 5)

    def test_same_brand_does_not_reuse_another_legal_entity(self):
        items = [dict(item("1", ""), encryptBrandId="brand"), dict(item("2", ""), encryptBrandId="brand")]
        with mock.patch.object(biz, "fetch_company_full_name", side_effect=["甲公司", "乙公司"]), \
             mock.patch.object(biz, "COMPANY_DETAIL_INTERVAL", 0):
            result = self.run_case([data(items)])
        self.assertEqual([row["company"] for row in result], ["甲公司", "乙公司"])

    def test_export_failure_exposes_recoverable_checkpoint(self):
        with mock.patch.object(biz, "export_rows", side_effect=OSError("磁盘错误")):
            with self.assertRaises(FetchError) as raised:
                self.run_case([data([item()])])
        result = raised.exception.result
        self.assertEqual(result.status, "failed")
        self.assertEqual(len(storage.recover_checkpoint(result.checkpoint)[0]), 1)
        self.assertEqual(result.paths, {})

    def test_cleanup_exception_does_not_discard_collected_data(self):
        with mock.patch.object(transport.CDPSession, "close", side_effect=OSError("关闭失败")):
            result = self.run_case([data([item()])])
        self.assertEqual(result.status, "completed")
        self.assertTrue(Path(result.paths["csv"]).exists())

    def test_cli_and_tui_preserve_outcome_exit_codes(self):
        for status in ("partial", "blocked", "cancelled", "empty", "completed"):
            result = FetchResult([], status=status)
            with mock.patch.object(biz, "run_fetch", return_value=result), \
                 mock.patch.object(biz, "close_owned_edge"):
                self.assertEqual(biz.main(["fetch", "--keyword", "x", "--city", "深圳"]), result.exit_code)
                with self.assertRaises(SystemExit) as raised:
                    tui.main(["--auto", "fetch"])
                self.assertEqual(raised.exception.code, result.exit_code)


class ThreadAndUiTests(unittest.TestCase):
    def test_parallel_task_output_is_isolated_from_main_and_other_task(self):
        ready = threading.Barrier(3)
        release = threading.Event()
        outer = io.StringIO()
        first, second = TaskRunner(), TaskRunner()
        def work(label):
            print(label + "-stdout")
            print(label + "-stderr", file=sys.stderr)
            ready.wait(timeout=2)
            if not release.wait(2):
                raise TimeoutError("测试同步失败")
            return []
        with contextlib.redirect_stdout(outer):
            original = (sys.stdout, sys.stderr)
            first.start("a", work, ("a",))
            second.start("b", work, ("b",))
            try:
                ready.wait(timeout=2)
                print("main-only")
            finally:
                release.set()
                first.wait()
                second.wait()
            self.assertEqual((sys.stdout, sys.stderr), original)
        self.assertIn("main-only", outer.getvalue())
        for runner, label, other in ((first, "a", "b"), (second, "b", "a")):
            text = runner.task["buf"].getvalue()
            self.assertIn(label + "-stdout", text)
            self.assertIn(label + "-stderr", text)
            self.assertNotIn(other + "-stdout", text)
            self.assertNotIn("main-only", text)

    def test_start_failure_is_terminal_not_forever_running(self):
        runner = TaskRunner()
        with mock.patch("task_runtime.threading.Thread.start", side_effect=RuntimeError("无法启动线程")):
            runner.start("a", lambda: [])
        runner.wait()
        self.assertFalse(runner.running)
        self.assertIsInstance(runner.task["error"], RuntimeError)

    def test_live_task_cannot_be_forgotten(self):
        release = threading.Event()
        runner = TaskRunner()
        runner.start("a", lambda: release.wait(2))
        try:
            with self.assertRaises(RuntimeError):
                runner.finish()
            self.assertFalse(runner.start("b", lambda: []))
        finally:
            release.set()
            runner.wait()

    def test_small_terminal_frame_has_exact_width_and_height(self):
        class Small(io.StringIO):
            columns, rows = 48, 14
        ctx = tui.Ctx()
        pages = [tui.OverviewPage(ctx), tui.ConfigPage(ctx), tui.LogPage(ctx), tui.ResultsPage(ctx)]
        app = terminal.TuiApp("测试" * 100, pages, output=Small())
        for index in range(3):
            app.current_page_index = index
            frame = app.build_frame()
            self.assertEqual(len(frame), 14)
            self.assertTrue(all(terminal.display_width(line) == 48 for line in frame))

    def test_offscreen_config_selection_becomes_visible(self):
        ctx = tui.Ctx()
        page = tui.ConfigPage(ctx)
        page.state["selection"] = 6
        app = types.SimpleNamespace(columns=80, content_height=5)
        self.assertIn("验证等待秒", "\n".join(page.render(app)))

    def test_log_stop_key_does_not_exit_app(self):
        ctx = tui.Ctx()
        ctx.tasks = mock.Mock()
        app = mock.Mock()
        self.assertTrue(tui.LogPage(ctx).handle_key("s", app))
        ctx.tasks.request_stop.assert_called_once_with()
        app.stop.assert_not_called()

    def test_late_stop_flag_does_not_relabel_completed_structured_result(self):
        result = FetchResult([{"company": "a"}])
        token = threading.Event()
        token.set()
        summary, _ = tui.task_summary({"desc": "测试", "result": result, "error": None,
                                       "stop_event": token, "stage": "完成"})
        self.assertIn("已完成", summary)
        self.assertNotIn("已停止", summary)

    def test_log_control_sequences_are_not_executed(self):
        self.assertEqual(terminal.safe_log_text("a\x1b[2Jb\x1b]52;evil\x07c"), "abc")


if __name__ == "__main__":
    unittest.main()
