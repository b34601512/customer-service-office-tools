"""v0.10 交付回归：城市、备用端口、停止保存与退出顺序。"""
import csv
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

import boss_cdp as biz
import boss_tui as tui


class ReleaseFixTests(unittest.TestCase):
    def test_city_shared_validation(self):
        ctx = tui.Ctx()
        page = tui.ConfigPage(ctx)
        app = tui.TuiApp('test', [page], output=io.StringIO())
        for value, expected in [('济南市', '济南'), (' 北京市 ', '北京'), ('101120100', '101120100')]:
            page._begin_edit(page.fields[1])
            page.state['edit_buffer'] = value
            page.handle_key('enter', app)
            self.assertEqual(ctx.config['city'], expected)
            self.assertEqual(biz.normalize_city(value), expected)
        for value in ['', '未知城市', '123', '../bad']:
            previous = ctx.config['city']
            page._begin_edit(page.fields[1])
            page.state['edit_buffer'] = value
            page.handle_key('enter', app)
            self.assertEqual(ctx.config['city'], previous)
            self.assertIn('未知城市', page.state['message'])
            with mock.patch.object(biz, 'ensure_edge_running') as edge:
                with self.assertRaises(ValueError):
                    biz.run_fetch('客服', value, 1, 'csv', 0, 9222)
                edge.assert_not_called()

    def test_reuse_owned_alternate_port(self):
        with mock.patch.dict(biz._owned_edge_processes, {9223: mock.Mock()}, clear=True), \
             mock.patch.object(biz, 'cdp_ready', side_effect=lambda p: p == 9223), \
             mock.patch.object(biz.subprocess, 'Popen') as launch:
            self.assertEqual(biz.ensure_edge_running(9222), 9223)
            self.assertEqual(biz.ensure_edge_running(9222), 9223)
            launch.assert_not_called()

    def test_stop_inside_page_exports_completed_items(self):
        stop = threading.Event()
        items = [{'jobId': '1', 'jobName': '客服'}, {'jobId': '2', 'jobName': '客服'}]
        def detail(*args, **kwargs):
            stop.set()
            return '已完成企业'
        real_export = biz.export_rows
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(biz, 'ensure_edge_running', return_value=9222), \
             mock.patch.object(biz, '_new_session', side_effect=[mock.Mock(), mock.Mock()]), \
             mock.patch.object(biz, '_await_joblist', return_value={'code': 0, 'zpData': {'jobList': items}}), \
             mock.patch.object(biz, 'fetch_company_full_name', side_effect=detail) as details, \
             mock.patch.object(biz, 'export_rows', side_effect=lambda *a: real_export(*a, outdir=directory)):
            rows = biz.run_fetch('客服', '济南市', 400, 'both', 3, 9222, stop_event=stop)
            self.assertEqual(len(rows), 1)
            self.assertEqual(details.call_count, 1)
            files = list(Path(directory).iterdir())
            self.assertEqual(len(files), 2)
            for path in files:
                with path.open(encoding='utf-8-sig', newline='') as stream:
                    saved = list(csv.DictReader(stream)) if path.suffix == '.csv' else json.load(stream)
                self.assertEqual(saved[0]['company'], '已完成企业')
                self.assertEqual(len(saved), 1)

    def test_exit_waits_for_save_then_closes_browser(self):
        ctx = tui.Ctx()
        app = tui.TuiApp('test', [mock.Mock(), mock.Mock(), mock.Mock()], output=io.StringIO())
        app.switch_page = mock.Mock()
        app.running = True
        saved = threading.Event()
        release = threading.Event()
        def work(stop_event):
            stop_event.wait(2)
            release.wait(2)
            saved.set()
        with mock.patch.object(biz, 'close_owned_edge') as close:
            ctx.tasks.start('test', work, cancellable=True)
            ctx.request_exit(app)
            self.assertTrue(app.running)
            self.assertTrue(ctx.exiting)
            self.assertTrue(app.exit_pending)
            close.assert_not_called()
            release.set()
            ctx.tasks.wait()
            self.assertTrue(saved.is_set())
            ctx.finish_exit(app)
            self.assertFalse(app.running)
            self.assertFalse(app.exit_pending)
            close.assert_called_once()

    def test_save_error_keeps_log_visible(self):
        ctx = tui.Ctx()
        app = mock.Mock()
        ctx.exiting = True
        ctx.tasks.task = {'done': True, 'error': OSError('磁盘写入失败')}
        ctx.finish_exit(app)
        app.stop.assert_not_called()
        app.request_render.assert_called_once()

    def test_cancel_network_wait_does_not_consume_events(self):
        stop = threading.Event()
        stop.set()
        session = mock.Mock()
        self.assertIsNone(biz._await_joblist(session, stop_event=stop))
        session.recv_event.assert_not_called()
