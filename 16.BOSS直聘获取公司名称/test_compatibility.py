"""迁移旧自检的浏览器生命周期、解析、配置和终端用例；网络全部隔离。"""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import types
import unittest
from unittest import mock

import boss_cdp as biz
import boss_tui as tui
import shop_subjects
from boss_types import FetchCancelled, VerificationRequired
from test_reliability import FakeSocket, data, item, session as session_for


class FakeTerminal(io.StringIO):
    columns, rows = 100, 24


def new_app():
    ctx = tui.Ctx()
    pages = [tui.OverviewPage(ctx), tui.ConfigPage(ctx), tui.LogPage(ctx), tui.ResultsPage(ctx)]
    app = tui.TuiApp('测试', pages, output=FakeTerminal(),
                     status_bar_provider=lambda a: tui.build_status_lines(ctx, a))
    return ctx, pages, app


class BrowserAndParsingTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(mock.patch.stopall)
        mock.patch.dict(biz._owned_edge_processes, {}, clear=True).start()
        mock.patch.object(biz, '_preserved_edge_ports', set()).start()

    def test_close_prefers_cdp_and_is_idempotent(self):
        biz._owned_edge_processes[9223] = types.SimpleNamespace(pid=4321)
        with mock.patch.object(biz, '_close_browser_via_cdp', return_value=True) as close, \
             mock.patch.object(biz, '_wait_for_cdp_closed', return_value=True), \
             mock.patch.object(biz, '_terminate_process_tree') as kill:
            self.assertTrue(biz.close_owned_edge(9223))
            self.assertFalse(biz.close_owned_edge(9223))
            close.assert_called_once_with(9223)
            kill.assert_not_called()

    def test_close_uses_only_owned_process_tree(self):
        biz._owned_edge_processes[9222] = types.SimpleNamespace(pid=4321)
        with mock.patch.object(biz, '_close_browser_via_cdp', return_value=False), \
             mock.patch.object(biz, '_wait_for_cdp_closed', return_value=False), \
             mock.patch.object(biz, '_terminate_process_tree') as kill:
            self.assertFalse(biz.close_owned_edge(9224))
            self.assertTrue(biz.close_owned_edge())
            kill.assert_called_once_with(4321)

    def test_handed_over_alternate_browser_is_reused_not_killed(self):
        biz._owned_edge_processes[9223] = types.SimpleNamespace(pid=4321)
        with contextlib.redirect_stdout(io.StringIO()):
            biz.preserve_owned_edge(9223)
        with mock.patch.object(biz, 'cdp_ready', side_effect=lambda port: port == 9223), \
             mock.patch.object(biz.subprocess, 'Popen') as launch, \
             mock.patch.object(biz, '_terminate_process_tree') as kill:
            self.assertEqual(biz.ensure_edge_running(9222), 9223)
            self.assertFalse(biz.close_owned_edge())
            launch.assert_not_called()
            kill.assert_not_called()

    def test_edge_launch_blank_page_with_bound_local_port(self):
        process = types.SimpleNamespace(pid=4321, poll=lambda: None)
        with tempfile.TemporaryDirectory() as folder, \
             mock.patch.object(biz, 'PROFILE_DIR', folder), \
             mock.patch.object(biz, 'find_edge', return_value=biz.EDGE_CANDIDATES[0]), \
             mock.patch.object(biz, 'find_free_port', return_value=9223), \
             mock.patch.object(biz, 'cdp_ready', side_effect=[False, True]), \
             mock.patch.object(biz.subprocess, 'Popen', return_value=process) as launch:
            self.assertEqual(biz.ensure_edge_running(9222), 9223)
        args = launch.call_args.args[0]
        self.assertEqual(args[0], biz.EDGE_CANDIDATES[0])
        self.assertEqual(args[-1], 'about:blank')
        self.assertIn('--remote-debugging-address=127.0.0.1', args)
        self.assertNotIn('--remote-allow-origins=*', args)

    def test_saved_profile_is_only_local_hint(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(biz, 'PROFILE_DIR', folder):
            self.assertFalse(tui.has_saved_profile())
            cookies = Path(folder) / 'Default' / 'Network' / 'Cookies'
            cookies.parent.mkdir(parents=True)
            cookies.touch()
            self.assertTrue(tui.has_saved_profile())

    def test_search_url_and_known_cities(self):
        self.assertIn('query=%E5%9B%BD%E5%86%85%E7%94%B5%E5%95%86', biz.search_url('国内电商', '101280600', 2))
        for city in ('深圳', '北京', '上海', '广州', '杭州'):
            self.assertTrue(biz.CITY_CODES[city].isdigit())

    def test_parser_normalizes_fields_without_fabricating_company(self):
        row = biz.parse_job({'jobId': 123, 'jobName': '运营', 'cityName': 101,
                             'jobLabels': ['经验不限', 3], 'skills': '办公软件', 'brandName': '某品牌'})
        self.assertEqual((row['job_id'], row['location'], row['tags']), ('123', '101', '经验不限,3'))
        self.assertEqual(row['skills'], '办公软件')
        self.assertEqual(row['company'], '')
        self.assertEqual(row['brand'], '某品牌')

    def test_loading_failure_without_response_is_not_hidden(self):
        from test_reliability import network_events
        event = network_events()[0]
        sock = FakeSocket(events=[event, {'method': 'Network.loadingFailed', 'params':
                                          {'requestId': 'R1', 'errorText': 'net::ERR_FAILED'}}])
        session = session_for(sock)
        session.expected_joblist = {'page': 1, 'query': '国内电商', 'city': '101280600'}
        with self.assertRaisesRegex(ConnectionError, 'ERR_FAILED'):
            biz._await_joblist(session, timeout=1)
        self.assertFalse(sock.commands)

    def test_login_empty_is_valid_without_cookie_or_reload(self):
        sock = FakeSocket([data()])
        session = session_for(sock)
        with mock.patch.object(biz, '_new_session', return_value=session), \
             mock.patch.object(biz, '_browser_has_auth_cookie') as cookies:
            self.assertTrue(biz.login_wait('国内电商', '101280600', login_timeout=1))
        self.assertEqual(sum(c['method'] == 'Page.navigate' for c in sock.commands), 1)
        cookies.assert_not_called()
        self.assertTrue(sock.closed)

    def test_login_timeout_keeps_manual_page_without_reload(self):
        sock = FakeSocket([data(code=37)])
        session = session_for(sock)
        with mock.patch.object(biz, '_new_session', return_value=session), \
             mock.patch.object(biz, '_await_joblist', return_value=None):
            self.assertFalse(biz.login_wait('国内电商', '101280600', login_timeout=1))
        methods = [c['method'] for c in sock.commands]
        self.assertEqual(methods.count('Page.navigate'), 1)
        self.assertNotIn('Page.close', methods)
        self.assertTrue(session.keep_open)

    def test_cli_failed_login_returns_two_and_cleans_up(self):
        with mock.patch.object(biz, 'ensure_edge_running', return_value=9222), \
             mock.patch.object(biz, 'login_wait', return_value=False), \
             mock.patch.object(biz, 'close_owned_edge') as close:
            self.assertEqual(biz.main(['setup', '--login-timeout', '1']), 2)
            close.assert_called_once_with()

    def test_detail_reads_main_document_after_finished(self):
        url = 'https://www.zhipin.com/job_detail/J1.html'
        sock = FakeSocket(events=[
            {'method': 'Network.responseReceived', 'params': {'type': 'Document', 'requestId': 'D1', 'response': {'url': url, 'status': 200}}},
            {'method': 'Network.loadingFinished', 'params': {'requestId': 'D1'}},
        ])
        sock.bodies['D1'] = '<li class="company-name"><span>公司名称</span>测试有限公司</li>'
        session = session_for(sock)
        self.assertEqual(biz.fetch_company_full_name(session, {'jobId': 'J1'}), '测试有限公司')
        body = [c for c in sock.commands if c['method'] == 'Network.getResponseBody']
        self.assertEqual(body[0]['params']['requestId'], 'D1')

    def test_detail_systemexit_keeps_received_rows(self):
        with mock.patch.object(biz, 'fetch_company_full_name', side_effect=SystemExit(0)):
            with self.assertRaises(SystemExit) as raised:
                biz.enrich_company_names(mock.Mock(), [item(company=''), item('J2', '')])
        self.assertEqual(len(raised.exception.rows), 2)

    def test_detail_verification_sets_keep_open(self):
        session = types.SimpleNamespace(keep_open=False)
        with mock.patch.object(biz, 'fetch_company_full_name', side_effect=VerificationRequired(37)):
            with self.assertRaises(VerificationRequired) as raised:
                biz.enrich_company_names(session, [item(company='')])
        self.assertTrue(session.keep_open)
        self.assertEqual(len(raised.exception.rows), 1)

    def test_shop_subject_must_match_unique_host(self):
        nodes = {'@graph': [{'@type': 'Organization', 'name': '平台有限公司', 'url': 'https://www.gys.cn'},
                            {'@type': 'Organization', 'name': '店铺企业有限公司', 'url': 'https://example.gys.cn'}]}
        html = '<script type="application/ld+json">' + json.dumps(nodes) + '</script>'
        self.assertEqual(shop_subjects.parse_shop(html, 'https://example.gys.cn/')['company'], '店铺企业有限公司')
        with self.assertRaises(ValueError):
            shop_subjects.parse_shop(html, 'https://other.gys.cn/')
        for url in ('https://gys.cn.example.com', 'https://www.gys.cn', 'https://example.com'):
            with self.assertRaises(ValueError):
                shop_subjects.normalize_shop_url(url)


class TuiCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.directory = mock.patch.object(biz, 'RESULT_DIR', self.folder.name)
        self.directory.start()
        self.addCleanup(self.directory.stop)
        self.ctx, self.pages, self.app = new_app()
        self.addCleanup(self.ctx.tasks.wait)

    def test_all_page_frames_are_exact_and_keep_author(self):
        for index in range(4):
            self.app.switch_page(index)
            frame = self.app.build_frame()
            self.assertEqual(len(frame), 24)
            self.assertIn('作者：黎路遥', frame[20])
            self.assertIn('版权所有 © 黎路遥', frame[21])
            self.assertTrue(all(tui.display_width(line) == 100 for line in frame))
            self.assertNotIn('\ufffd', '\n'.join(frame))
            self.assertTrue(all(label in frame[3] for label in ('1首页', '2配置', '3日志', '4结果')))

    def test_home_order_matches_profile_hint(self):
        with mock.patch.object(tui, 'has_saved_profile', return_value=False):
            self.assertIn('首次登录', self.pages[0].items[0][0])
        with mock.patch.object(tui, 'has_saved_profile', return_value=True):
            self.assertEqual(self.pages[0].items[0][0], '采集BOSS招聘企业')
            self.assertIn('首次登录', self.pages[0].items[-1][0])

    def test_global_switch_and_exit(self):
        self.app.on_exit_request = mock.Mock()
        self.app.dispatch_key('right')
        self.assertEqual(self.app.current_page_index, 1)
        self.app.dispatch_key('3')
        self.assertEqual(self.app.current_page_index, 2)
        self.app.dispatch_key('q')
        self.assertEqual(self.app.current_page_index, 0)
        self.app.dispatch_key('0')
        self.app.dispatch_key('ctrl-c')
        self.assertEqual(self.app.on_exit_request.call_count, 2)

    def test_form_saves_only_on_enter_and_escape_discards(self):
        page = self.pages[1]
        for index in (0, 2, 3, 6):
            page.state['selection'] = index
            previous = dict(self.ctx.config)
            self.assertIsNone(page.handle_key('right', self.app))
            page.handle_key('enter', self.app)
            page.handle_key('x' if index == 0 else 'right', self.app)
            self.assertEqual(self.ctx.config, previous)
            page.handle_key('esc', self.app)
            self.assertEqual(self.ctx.config, previous)
        page.state['selection'] = 0
        page.handle_key('enter', self.app)
        for _ in page.state['edit_buffer']:
            page.handle_key('backspace', self.app)
        for char in '国内电商qr123':
            page.handle_key(char, self.app)
        page.handle_key('enter', self.app)
        self.assertEqual(self.ctx.config['keyword'], '国内电商qr123')

    def test_page_limit_and_format_arrows(self):
        page = self.pages[1]
        page._begin_edit(page.fields[2])
        page.state['edit_buffer'] = '1000'
        page.handle_key('right', self.app)
        page.handle_key('enter', self.app)
        self.assertEqual(self.ctx.config['pages'], 1000)
        page._begin_edit(page.fields[3])
        page.handle_key('right', self.app)
        page.handle_key('enter', self.app)
        self.assertEqual(self.ctx.config['format'], 'json')
        page.handle_key('r', self.app)
        self.assertEqual(self.ctx.config, tui.default_config())

    def test_start_uses_saved_config_and_verification_timeout(self):
        self.ctx.config.update(city='北京', pages=400, title_filter='电商', verification_timeout=120)
        with mock.patch.object(biz, 'run_fetch', return_value=[]) as fetch:
            self.ctx.start_fetch(self.app)
            self.ctx.tasks.wait()
        self.assertEqual(fetch.call_args.args[:4], ('国内电商', '北京', 400, 'csv'))
        self.assertEqual(fetch.call_args.kwargs['verification_timeout'], 120)
        self.assertEqual(fetch.call_args.kwargs['title_filter'], '电商')
        self.assertEqual(self.app.current_page_index, 2)

    def test_non_tty_returns_frame_without_input_loop(self):
        with mock.patch.object(self.app, '_interactive_terminal', return_value=False):
            self.app.start()
            self.app.stop()
        self.assertIn('首页', self.app.output.getvalue())
        self.assertIn('黎路遥', self.app.output.getvalue())

    def test_cleanup_idempotent(self):
        with mock.patch.object(biz, 'close_owned_edge') as close:
            self.ctx.cleanup()
            self.ctx.cleanup()
        close.assert_called_once_with()

    def test_running_log_shows_real_progress(self):
        entered, release = threading.Event(), threading.Event()
        def work(progress):
            progress(1, 3, '等待第2页响应', '已等待2s')
            print('真实线程日志')
            entered.set()
            release.wait(2)
            return []
        self.ctx.tasks.start('测试', work, with_progress=True, total=3)
        try:
            self.assertTrue(entered.wait(1))
            text = '\n'.join(self.pages[2].render(self.app))
            self.assertIn('等待第2页响应', text)
            self.assertIn('已等待2s', text)
            self.assertIn('真实线程日志', text)
        finally:
            release.set()
            self.ctx.tasks.wait()
