#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""统一自检入口。默认仅离线夹具/真实临时文件/真实线程；实机测试必须显式启用。

python selftest.py
python selftest.py --with-edge
python selftest.py --with-real-fetch
旧 selftest 的业务/界面用例迁移到 test_compatibility 与 test_reliability。
"""
import argparse
import importlib
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest import mock

import boss_cdp as biz
import boss_tui as tui
from test_compatibility import new_app


TEST_MODULES = ('test_fetch_result', 'test_reliability', 'test_compatibility',
                'test_release_fixes', 'test_jd_shops')


def check_windows_console():
    """在子进程隐藏控制台注入真实 Unicode/方向键事件，通过生产输入器和 TUI 消费。"""
    import ctypes
    from ctypes import wintypes
    from console_input import InputRecord, KeyEvent, WindowsConsoleInput
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                               wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    api.CreateFileW.restype = wintypes.HANDLE
    api.SetStdHandle.argtypes = [wintypes.DWORD, wintypes.HANDLE]
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    api.GetConsoleMode.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    api.WriteConsoleInputW.argtypes = [wintypes.HANDLE, ctypes.POINTER(InputRecord),
                                     wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    handle = api.CreateFileW('CONIN$', 0xC0000000, 3, None, 3, 0, None)
    assert handle != wintypes.HANDLE(-1).value
    assert api.SetStdHandle(-10, handle)
    original = wintypes.DWORD()
    assert api.GetConsoleMode(handle, ctypes.byref(original))

    def record(char='\x00', vk=0, down=True, repeat=1, kind=1):
        value = InputRecord()
        value.type = kind
        value.event.key = KeyEvent(down, repeat, vk, 0, char, 0)
        return value

    def write(events):
        buffer = (InputRecord * len(events))(*events)
        count = wintypes.DWORD()
        assert api.WriteConsoleInputW(handle, buffer, len(buffer), ctypes.byref(count))
        assert count.value == len(buffer)

    try:
        reader = WindowsConsoleInput()
        try:
            assert ctypes.sizeof(InputRecord) == 20
            assert reader.poll() == []
            for codepage in (936, 65001):
                assert api.SetConsoleCP(codepage)
                for char in '济南杭州上海一客服à':
                    write([record(char)])
                    assert reader.poll() == [char]
                    assert reader.poll() == []
            write([record(vk=0xE5), record(vk=0x10), record('南', down=False), record(kind=4)])
            assert reader.poll() == []
            write([record(vk=0x1B), record('a'), record(vk=0x26), record('x', repeat=3)])
            assert reader.poll() == ['esc', 'a', 'up', 'x', 'x', 'x']
        finally:
            reader.close()
        ctx, pages, app = new_app()
        app.on_exit_request = app.stop
        events = [record('2'), record(vk=0x28), record('\r'), record('\x08', repeat=2)]
        events += [record(ch) for ch in '杭州'] + [record('\r')]
        events += [record(vk=0x28, repeat=3), record('\r')]
        events += [record(ch) for ch in '客服,仓管'] + [record('\r'), record('\r'), record('错'), record('\x1b')]
        events += [record(vk=0x26, repeat=2), record('\r'), record(vk=0x27), record('\r')]
        events += [record(vk=0x28), record('\r'), record(vk=0x27), record('\r'), record('q'), record('\x03')]
        write(events)
        try:
            with mock.patch.object(app, '_interactive_terminal', return_value=True):
                app.start()
            expected = tui.default_config()
            expected.update(city='杭州', pages=2, format='json', title_filter='客服,仓管')
            assert ctx.config == expected, ctx.config
            assert pages[1].state['editing'] is None and not app.running
            assert '杭州' in app.output.getvalue() and '客服,仓管' in app.output.getvalue()
        finally:
            app.stop()
        restored = wintypes.DWORD()
        assert api.GetConsoleMode(handle, ctypes.byref(restored))
        assert restored.value == original.value
    finally:
        api.CloseHandle(handle)
    print('真实控制台 Unicode 编辑、取消、保存、退出、模式恢复 PASS')


class LiveTests(unittest.TestCase):
    with_edge = False
    with_real_fetch = False

    @unittest.skipUnless(os.name == 'nt', '需要 Windows 控制台 API')
    def test_windows_console(self):
        result = subprocess.run(
            [sys.executable, '-B', '-c', 'from selftest import check_windows_console; check_windows_console()'],
            cwd=Path(__file__).parent, creationflags=subprocess.CREATE_NO_WINDOW,
            capture_output=True, encoding='utf-8', timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('PASS', result.stdout)

    def test_edge_launch_and_cdp(self):
        if not self.with_edge:
            self.skipTest('需 --with-edge 才启动真实 Edge')
        before = set(biz._owned_edge_processes)
        port = biz.ensure_edge_running()
        try:
            self.assertTrue(biz.cdp_ready(port))
            session = biz._new_session(port)
            try:
                result = session.command('Browser.getVersion', timeout=10)
                self.assertTrue(result.get('product'))
            finally:
                session.close()
        finally:
            if port not in before and port in biz._owned_edge_processes:
                self.assertTrue(biz.close_owned_edge(port))
                self.assertFalse(biz.cdp_ready(port))

    def test_profile_hint_on_real_machine(self):
        if not self.with_edge:
            self.skipTest('需 --with-edge 才检查实机 Profile')
        print('[info] Profile已创建（非登录保证）：', tui.has_saved_profile())

    def test_real_fetch_one_page(self):
        if not self.with_real_fetch:
            self.skipTest('需 --with-real-fetch，登录/验证由用户完成')
        folder = Path(biz.RESULT_DIR) / ('verification_' + time.strftime('%Y%m%d_%H%M%S'))
        try:
            result = biz.run_fetch('国内电商', '深圳', 1, 'both', 3, biz.DEFAULT_PORT,
                                   verification_timeout=300, outdir=folder)
            self.assertEqual(result.status, 'completed', result.reason)
            self.assertGreater(len(result), 0, '真实搜索无结果不能作为采集成功验收')
            self.assertTrue(all(row['company'] for row in result), '企业全称仍有缺失')
            ids = [row['job_id'] for row in result if row['job_id']]
            self.assertEqual(len(ids), len(set(ids)))
            self.assertEqual(set(result.paths), {'csv', 'json'})
            self.assertTrue(all(Path(path).is_file() for path in result.paths.values()))
            recovered, _ = biz.recover_checkpoint(result.checkpoint)
            self.assertEqual(recovered, result)
            print('[验收结果保留]', folder)
        finally:
            biz.close_owned_edge()  # 验证中的浏览器已移交用户，不会被这里关闭。


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--with-edge', action='store_true')
    parser.add_argument('--with-real-fetch', action='store_true')
    args = parser.parse_args(argv)
    LiveTests.with_edge, LiveTests.with_real_fetch = args.with_edge, args.with_real_fetch
    suite = unittest.TestSuite()
    for name in TEST_MODULES:
        suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(importlib.import_module(name)))
    suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(LiveTests))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    failed = len(result.failures) + len(result.errors)
    print('[summary] PASS/FAIL/SKIP:', result.testsRun - failed - len(result.skipped), failed, len(result.skipped))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
