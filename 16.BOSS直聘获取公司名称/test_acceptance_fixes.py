"""Issue #654/#655 的回归测试；不启动真实浏览器、不访问网站。"""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

import boss_cdp as biz
import boss_tui as tui
import edge_profile
import jd_session
import jd_shops as jd


class EdgeProfileTests(unittest.TestCase):
    def fake_biz(self, directory):
        return types.SimpleNamespace(
            PROFILE_DIR=str(directory), DEFAULT_PORT=9222,
            cdp_ready=mock.Mock(return_value=False),
            ensure_edge_running=mock.Mock(return_value=9224),
            _owned_edge_processes={}, _preserved_edge_ports=set(),
        )

    def test_persisted_live_port_is_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = self.fake_biz(directory)
            edge_profile.remember_profile_edge(directory, 9223, 1234)
            fake.cdp_ready.side_effect = lambda port, *a, **k: port == 9223
            self.assertEqual(edge_profile.discover_profile_edge(fake, 9222), 9223)
            fake.cdp_ready.assert_called()

    def test_stale_persisted_port_is_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = self.fake_biz(directory)
            edge_profile.remember_profile_edge(directory, 9223, 1234)
            self.assertIsNone(edge_profile.discover_profile_edge(fake, 9222))
            self.assertFalse((Path(directory) / edge_profile.STATE_FILE).exists())

    def test_windows_process_commandline_finds_exact_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = self.fake_biz(directory)
            command = (
                '"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" '
                '--remote-debugging-port=9223 '
                f'"--user-data-dir={directory}" --new-window'
            )
            fake.cdp_ready.side_effect = lambda port, *a, **k: port == 9223
            processes = [
                {'ProcessId': 10, 'CommandLine': '--remote-debugging-port=9333 --user-data-dir=C:\\other'},
                {'ProcessId': 11, 'CommandLine': command},
            ]
            with mock.patch.object(edge_profile.os, 'name', 'nt'), \
                 mock.patch.object(edge_profile, '_windows_edge_processes', return_value=processes):
                self.assertEqual(edge_profile.discover_profile_edge(fake, 9222), 9223)
            saved = json.loads((Path(directory) / edge_profile.STATE_FILE).read_text(encoding='utf-8'))
            self.assertEqual((saved['port'], saved['pid']), (9223, 11))

    def test_ensure_reuses_discovered_port_without_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = self.fake_biz(directory)
            with mock.patch.object(edge_profile, 'discover_profile_edge', return_value=9223):
                self.assertEqual(edge_profile.ensure_profile_edge(fake, 9222), 9223)
            fake.ensure_edge_running.assert_not_called()
            self.assertIn(9223, fake._preserved_edge_ports)

    def test_ensure_launches_once_and_records_new_port(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = self.fake_biz(directory)
            fake._owned_edge_processes[9224] = types.SimpleNamespace(pid=4321)
            with mock.patch.object(edge_profile, 'discover_profile_edge', return_value=None):
                self.assertEqual(edge_profile.ensure_profile_edge(fake, 9222), 9224)
            fake.ensure_edge_running.assert_called_once_with(9222, start_url='about:blank')
            saved = json.loads((Path(directory) / edge_profile.STATE_FILE).read_text(encoding='utf-8'))
            self.assertEqual((saved['port'], saved['pid']), (9224, 4321))


class JdInfrastructureTests(unittest.TestCase):
    def test_reader_wraps_browser_connect_failure(self):
        reader = jd_session.JdPageReader()
        with mock.patch.object(jd_session.edge_profile, 'ensure_profile_edge',
                               side_effect=TimeoutError('Profile 被占用')):
            with self.assertRaises(jd_session.BrowserSessionError) as raised:
                reader._connect()
        self.assertIn('Profile 被占用', str(raised.exception))
        self.assertIsNone(reader.session)

    def test_shared_browser_failure_stops_after_first_shop(self):
        urls = [f'https://mall.jd.com/index-{number}.html' for number in (1, 2, 3)]
        reader = mock.Mock()
        reader.read.side_effect = jd_session.BrowserSessionError('无法连接专用 Edge/CDP')
        manager = mock.Mock()
        manager.return_value.__enter__.return_value = reader
        with mock.patch.object(jd, 'read_shop_urls', return_value=urls), \
             mock.patch.object(jd, 'JdPageReader', manager), \
             mock.patch.object(jd, 'export_rows') as export:
            with self.assertRaisesRegex(RuntimeError, '浏览器会话不可用'):
                jd.run_shops(input_path='ignored.txt')
        reader.read.assert_called_once_with(urls[0])
        self.assertEqual(len(export.call_args.args[0]), 1)
        reports = export.call_args.args[1]
        self.assertEqual(reports[0]['状态'], '失败')
        self.assertIn('无法连接专用 Edge/CDP', reports[0]['原因'][0])


class TuiAcceptanceTests(unittest.TestCase):
    def test_fetch_wrapper_replaces_default_with_discovered_profile_port(self):
        with mock.patch.object(tui, 'print_diagnostics'), \
             mock.patch.object(tui.edge_profile, 'resolve_profile_port', return_value=9223), \
             mock.patch.object(tui.biz, 'run_fetch', return_value=[]) as fetch:
            self.assertEqual(tui.run_boss_fetch('国内电商', '深圳', 1, 'csv', 3, 9222), [])
        self.assertEqual(fetch.call_args.args[5], 9223)

    def test_utf8_reconfigure_covers_stdout_and_stderr(self):
        stdout, stderr = mock.Mock(), mock.Mock()
        with mock.patch.object(tui.sys, 'stdout', stdout), mock.patch.object(tui.sys, 'stderr', stderr):
            tui.ensure_console_utf8()
        stdout.reconfigure.assert_called_once_with(encoding='utf-8', errors='replace')
        stderr.reconfigure.assert_called_once_with(encoding='utf-8', errors='replace')


if __name__ == '__main__':
    unittest.main()
