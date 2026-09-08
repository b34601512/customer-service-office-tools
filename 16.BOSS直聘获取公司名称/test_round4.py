"""#654/#659/#660/#661 回归：执行真实生产入口，网站/浏览器由隔离夹具替代。
不会访问网站、启动浏览器或读个人Profile；文件测试使用临时目录。
"""
import contextlib
import io
import itertools
import json
from pathlib import Path
import tempfile
import threading
import types
import unittest
from unittest import mock

import boss_cdp as biz
import boss_pagination as pagination
import boss_tui as tui
import jd_fields as fields
import jd_session as session
import jd_shops as jd
import shop_subjects as supplier


class QuietTest(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
        self.directory = self.stack.enter_context(tempfile.TemporaryDirectory(prefix='round4_中文_'))


class FieldTests(QuietTest):
    def test_issue659_original_score_and_company_assertions(self):
        scores, conflicts = fields.page_fields(
            '店铺星级 商品评价 9.5 高 物流履约 9.7 高 售后服务 8.0 高', '', fields.SCORE_FIELDS)
        self.assertFalse(conflicts)
        self.assertEqual(scores, dict(商品评价='9.5', 物流履约='9.7', 售后服务='8.0'))
        company, conflicts = fields.page_fields('',
            '<script>window.data={"companyName":"甲公司","legalPerson":"张三","regCapital":"50万元"}</script>',
            fields.COMPANY_FIELDS)
        self.assertFalse(conflicts)
        self.assertEqual(company, {'公司名': '甲公司', '法人': '张三', '注册资本': '50万元'})

    def test_punctuation_does_not_mix_score_values(self):
        for separator in (' ', '、', '，', ';', '|', '\t'):
            with self.subTest(separator=separator):
                text = separator.join(('商品评价 9.5', '物流履约 9.7', '售后服务 8.0'))
                self.assertEqual(fields.labeled_fields(text, fields.SCORE_FIELDS),
                                 (dict(商品评价='9.5', 物流履约='9.7', 售后服务='8.0'), []))

    def test_reverse_score_sequences_are_not_also_read_forward(self):
        self.assertEqual(fields.labeled_fields('9.5 商品评价 9.7 物流履约 8.0 售后服务', fields.SCORE_FIELDS),
                         (dict(商品评价='9.5', 物流履约='9.7', 售后服务='8.0'), []))
        self.assertEqual(fields.labeled_fields('9.5分 商品评价', fields.SCORE_FIELDS), ({'商品评价': '9.5'}, []))

    def test_invalid_scores_never_become_valid_substrings(self):
        for text in ('-1', '11', '15.8', '95%', '提高了1.0%', '1e2', '1.2.3', '5/10', 'abc9.5', 'NaN'):
            with self.subTest(text=text):
                self.assertEqual(fields.labeled_fields('商品评价 ' + text, fields.SCORE_FIELDS)[0], {})

    def test_zero_and_valid_bounds(self):
        for value in ('0', '0.0', '10', '10.0', '9.5分'):
            self.assertTrue(fields.labeled_fields('商品评价 ' + value, fields.SCORE_FIELDS)[0])
        self.assertEqual(fields.structured_fields('{"productScore":0}', fields.SCORE_FIELDS)[0], {'商品评价': '0'})

    def test_real_conflict_is_still_rejected(self):
        value, conflicts = fields.page_fields('商品评价：9.5', '{"productScore":8.1}', fields.SCORE_FIELDS)
        self.assertNotIn('商品评价', value)
        self.assertIn('商品评价', conflicts)

    def test_company_label_prefix_and_adjacent_labels(self):
        self.assertEqual(fields.labeled_fields('电话客服\n手机维修\n公司名册', fields.COMPANY_FIELDS)[0], {})
        self.assertEqual(fields.labeled_fields('公司名称\n电话：010-1111', ['公司名'])[0], {})

    def test_header_accepts_only_raw_controls_inside_json_strings(self):
        header = '<li>商品评价\n9.5\t分</li>'
        text = '{"result":true,"html":"' + header + '"}'
        self.assertEqual(fields.header_html(text), header)
        self.assertEqual(fields.header_html('callback(' + text + ');'), header)
        self.assertEqual(fields.header_html(json.dumps({'result': True, 'html': header})), header)

    def test_header_rejects_bad_json_and_executable_jsonp(self):
        for text in ('{"result":true,"html":"cut', '{"result":false,"html":"x"}',
                     'callback({"result":true,"html":"x"});attack()',
                     '<html>验证码</html>', '{"result":true,"html":42}',
                     '{"result":true,\nBAD:"x"}'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                fields.header_html(text)


class SessionTests(QuietTest):
    URL = 'https://mall.jd.com/showLicence-123.html'

    def reader(self, pages):
        reader = session.JdPageReader(verification_timeout=2)
        reader.session = mock.Mock(keep_open=False)
        reader.session.wait_response.return_value = {'result': {}}
        reader._snapshot = mock.Mock(side_effect=pages)
        reader._pause = mock.Mock()
        return reader

    def ready(self, **updates):
        return dict(url=self.URL, ready=True, text='公司名称：测试企业', html='<div>公司名称：测试企业</div>', **updates)

    def test_timeout_validation_is_finite_and_zero_is_supported(self):
        self.assertEqual(session.JdPageReader(verification_timeout=0).verification_timeout, 0)
        for value in (float('nan'), float('inf'), -1, True, 3601):
            with self.subTest(value=value), self.assertRaises(ValueError):
                session.JdPageReader(verification_timeout=value)

    def test_target_cannot_change_authority_or_required_query(self):
        self.assertTrue(session._target_matches(self.URL + '?scene=pc', self.URL))
        for url in (self.URL.replace('mall.jd.com', 'mall.jd.com:444'),
                    self.URL.replace('mall.jd.com', 'user@mall.jd.com'),
                    self.URL.replace('123', '456')):
            self.assertFalse(session._target_matches(url, self.URL))
        self.assertFalse(session._target_matches(self.URL + '?from=other', self.URL + '?from=tool'))

    def test_script_failure_is_not_a_silent_website_timeout(self):
        reader = session.JdPageReader()
        reader.session = mock.Mock()
        reader.session.wait_response.return_value = {'result': {'exceptionDetails': {'text': 'SyntaxError'}}}
        with self.assertRaisesRegex(session.BrowserSessionError, '脚本执行失败'):
            reader._snapshot()

    def test_only_context_switch_is_treated_as_transient(self):
        reader = session.JdPageReader()
        reader.session = mock.Mock()
        reader.session.wait_response.return_value = {'error': {'message': 'Execution context was destroyed'}}
        self.assertIsNone(reader._snapshot())
        reader.session.wait_response.return_value = {'error': {'message': 'invalid parameters'}}
        with self.assertRaises(session.BrowserSessionError):
            reader._snapshot()

    def test_cancelled_cdp_wait_maps_to_collection_stop(self):
        reader = session.JdPageReader()
        reader.session = mock.Mock()
        reader.session.wait_response.side_effect = biz.FetchCancelled('stop')
        with self.assertRaises(session.CollectionStopped):
            reader._snapshot()

    def test_missing_navigation_ack_does_not_read_stale_page(self):
        reader = self.reader([])
        reader.session.wait_response.return_value = None
        with self.assertRaises(session.BrowserSessionError):
            reader.read(self.URL)
        reader._snapshot.assert_not_called()

    def test_zero_wait_preserves_verification_page_without_retry(self):
        reader = self.reader([{'url': self.URL, 'blocked': True}])
        reader.verification_timeout = 0
        reader.port = 9223
        with mock.patch.object(session.boss_cdp, 'preserve_owned_edge') as preserve:
            with self.assertRaises(session.VerificationTimeout):
                with reader:
                    reader.read(self.URL)
        preserve.assert_called_once_with(9223)
        self.assertTrue(reader.session.keep_open)
        self.assertEqual(sum(call.args[0] == 'Page.navigate' for call in reader.session.send.call_args_list), 1)

    def test_manual_verification_resumes_same_page_without_refresh(self):
        ready = self.ready()
        reader = self.reader([{'url': self.URL, 'blocked': True}, ready, ready, ready])
        reader.verification_timeout = 30
        with mock.patch.object(session.time, 'monotonic', side_effect=itertools.count()):
            self.assertEqual(reader.read(self.URL), ready)
        self.assertFalse(reader.session.keep_open)
        self.assertEqual(sum(call.args[0] == 'Page.navigate' for call in reader.session.send.call_args_list), 1)

    def test_timeout_diagnostics_exclude_tokens_and_page_text(self):
        page = {'url': self.URL + '?token=SECRET&securityId=PRIVATE', 'ready': False,
                'text': '账号: SECRET_ACCOUNT', 'html': 'secret-document', 'readyState': 'loading'}
        reader = self.reader(itertools.repeat(page))
        with mock.patch.object(session.time, 'monotonic', side_effect=itertools.count(0, 10)):
            with self.assertRaises(TimeoutError) as raised:
                reader.read(self.URL)
        text = str(raised.exception)
        self.assertIn('loading', text)
        for secret in ('SECRET', 'PRIVATE', 'secret-document', 'token=', 'securityId='):
            self.assertNotIn(secret, text)

    def test_snapshot_shape_errors_are_explicit(self):
        reader = session.JdPageReader()
        reader.session = mock.Mock()
        reader.session.wait_response.return_value = {'result': {'result': {'value': []}}}
        with self.assertRaisesRegex(session.BrowserSessionError, '结构无效'):
            reader._snapshot()


class JdFlowTests(QuietTest):
    URL = 'https://mall.jd.com/index-123.html'
    HTML = '<title>测试店 - 京东</title><input id="shop_id" value="123"><input id="vender_id" value="456"><input id="pageInstance_appId" value="99">'

    def arrange(self, pages):
        reader = mock.Mock(last_diagnostics={})
        reader.read.side_effect = pages
        manager = mock.MagicMock()
        manager.__enter__.return_value = reader
        self.stack.enter_context(mock.patch.object(jd, 'read_shop_urls', return_value=[self.URL, self.URL.replace('123', '789')]))
        self.stack.enter_context(mock.patch.object(jd, 'JdPageReader', return_value=manager))
        self.stack.enter_context(mock.patch.object(jd.time, 'sleep'))
        return reader

    def base(self):
        return {'url': self.URL, 'text': '', 'html': self.HTML}

    def test_raw_control_header_enrichment_keeps_scores(self):
        row = jd.parse_shop_page(self.HTML, self.URL)
        reader = mock.Mock()
        reader.read.side_effect = [
            {'text': '{"result":true,"html":"<li>商品评价\n9.5</li><li>物流履约：9.7</li><li>售后服务：8.0</li>"}'},
            {'text': '公司名称：测试公司\n法人：测试法人'},
        ]
        reasons, evidence = [], {}
        jd.enrich_shop(reader, self.base(), row, reasons, evidence)
        self.assertEqual([row[f] for f in fields.SCORE_FIELDS], ['9.5', '9.7', '8.0'])
        self.assertEqual(row['公司名'], '测试公司')
        self.assertEqual(row['手机'], '')
        self.assertIn('商品评价', evidence)

    def test_verification_is_blocked_not_user_cancelled(self):
        reader = self.arrange([self.base(), session.VerificationTimeout('请完成验证')])
        result = jd.run_shops(input_path='unused', outdir=self.directory)
        self.assertEqual((result.status, result.exit_code, len(result)), ('blocked', 3, 1))
        self.assertEqual(result[0]['VenderId'], '456')
        self.assertEqual(reader.read.call_count, 2)
        self.assertTrue(all(Path(p).exists() for p in result.paths))

    def test_header_infrastructure_failure_stops_batch(self):
        reader = self.arrange([self.base(), session.BrowserSessionError('连接中断')])
        with self.assertRaisesRegex(RuntimeError, '浏览器会话不可用'):
            jd.run_shops(input_path='unused', outdir=self.directory)
        self.assertEqual(reader.read.call_count, 2)
        self.assertEqual(len(list(Path(self.directory).glob('*.xlsx'))), 1)

    def test_user_cancel_keeps_base_data_and_130(self):
        reader = self.arrange([self.base(), session.CollectionStopped('stop')])
        result = jd.run_shops(input_path='unused', outdir=self.directory)
        self.assertEqual((result.status, result.exit_code, len(result)), ('cancelled', 130, 1))
        self.assertEqual(reader.read.call_count, 2)

    def test_export_error_cannot_be_hidden_by_cancellation(self):
        self.arrange([self.base(), session.CollectionStopped('stop')])
        with mock.patch.object(jd, 'export_rows', side_effect=PermissionError('只读')):
            with self.assertRaises(PermissionError):
                jd.run_shops(input_path='unused', outdir=self.directory)

    def test_missing_fields_remain_partial_and_reports_include_state(self):
        reader = self.arrange([self.base(), ValueError('无评分'), TimeoutError('无资质'),
                               self.base() | {'html': self.HTML.replace('123', '789')},
                               ValueError('无评分'), TimeoutError('无资质')])
        reader.last_diagnostics = {'ready_state': 'loading', 'images': 1}
        result = jd.run_shops(input_path='unused', outdir=self.directory)
        self.assertEqual((result.status, result.exit_code), ('partial', 2))
        self.assertTrue(all(len(report['缺失列']) == 11 for report in result.reports))
        report = json.loads(Path(result.paths[1]).read_text(encoding='utf-8'))
        self.assertEqual(report[0]['页面状态']['ready_state'], 'loading')


class PaginationTests(QuietTest):
    def fake(self):
        return types.SimpleNamespace(expected_joblist={'page': 2, 'query': '国内电商', 'city': '101280600'},
            joblist_requests={}, command=mock.Mock(return_value={'result': {'value': {'moved': True}}}))

    def test_prefetched_page_does_not_scroll_again(self):
        current = self.fake()
        current.joblist_requests['R'] = {'page': ['2'], 'query': ['国内电商'], 'city': ['101280600']}
        pagination.advance_page(current)
        current.command.assert_called_once_with('Page.bringToFront')

    def test_wrong_search_request_does_not_skip_scroll(self):
        current = self.fake()
        current.joblist_requests['R'] = {'page': ['2'], 'query': ['别的词'], 'city': ['101280600']}
        pagination.advance_page(current)
        self.assertEqual(current.command.call_count, 2)
        call = current.command.call_args
        self.assertEqual(call.args[0], 'Runtime.evaluate')
        self.assertTrue(call.args[1]['awaitPromise'])
        self.assertIn('document.scrollingElement', call.args[1]['expression'])

    def test_layout_command_failure_is_not_success(self):
        current = self.fake()
        current.command.side_effect = [None, biz.ProtocolError('bad script')]
        with self.assertRaises(biz.ProtocolError):
            pagination.advance_page(current)

    def test_request_diagnostics_are_counts_not_credentials(self):
        current = self.fake()
        current.joblist_requests['R-token-private'] = {'page': ['3'], 'query': ['秘密'], 'token': ['SECRET']}
        text = pagination.request_diagnostics(current)
        self.assertIn('observed_pages=3', text)
        self.assertNotIn('秘密', text)
        self.assertNotIn('SECRET', text)
        self.assertNotIn('private', text)


class BossFlowTests(QuietTest):
    def run_pages(self, pages, **kwargs):
        fake = mock.Mock(keep_open=False)
        with mock.patch.object(biz, 'ensure_edge_running', return_value=9223), \
             mock.patch.object(biz, '_new_session', return_value=fake), \
             mock.patch.object(biz, 'fetch_page', side_effect=pages):
            return biz.run_fetch('国内电商', '深圳', 2, 'both', 0, 9222, outdir=self.directory, **kwargs)

    def row(self):
        return biz.parse_job({'jobId': '1', 'companyName': '测试公司', 'jobName': '客服'})

    def test_later_timeout_is_partial_and_real_files_survive(self):
        result = self.run_pages([[self.row()], TimeoutError('第二页超时')])
        self.assertEqual((result.status, result.exit_code, result.completed_pages), ('partial', 2, 1))
        self.assertEqual(len(result), 1)
        self.assertTrue(all(Path(path).exists() for path in result.paths.values()))
        self.assertEqual(biz.recover_checkpoint(result.checkpoint)[0], list(result))
        self.assertEqual(json.loads(Path(result.checkpoint + '.status.json').read_text())['status'], 'partial')

    def test_first_page_timeout_still_fails(self):
        with self.assertRaises(biz.FetchError) as raised:
            self.run_pages([TimeoutError('超时')])
        self.assertEqual(raised.exception.result.exit_code, 1)

    def test_network_oserror_with_data_is_partial(self):
        result = self.run_pages([[self.row()], OSError('socket gone')])
        self.assertEqual(result.exit_code, 2)

    def test_checkpoint_write_error_is_failed_not_partial(self):
        with mock.patch.object(biz.CheckpointStore, 'write_page', side_effect=PermissionError('磁盘只读')):
            with self.assertRaises(biz.FetchError) as raised:
                self.run_pages([[self.row()]])
        self.assertEqual(raised.exception.result.exit_code, 1)
        self.assertTrue(raised.exception.result.paths)

    def test_manifest_failure_is_not_a_success(self):
        with mock.patch.object(biz.CheckpointStore, 'finish', side_effect=PermissionError('状态文件只读')):
            with self.assertRaises(biz.FetchError) as raised:
                self.run_pages([[self.row()], []])
        self.assertEqual(raised.exception.result.exit_code, 1)
        self.assertIn('状态清单', raised.exception.result.reason)

    def test_export_failure_overrides_cancelled_status(self):
        with mock.patch.object(biz, 'export_rows', side_effect=PermissionError('磁盘只读')):
            with self.assertRaises(biz.FetchError) as raised:
                self.run_pages([[self.row()], biz.FetchCancelled('stop')])
        self.assertEqual(raised.exception.result.exit_code, 1)

    def test_cancelled_job_keeps_saved_data(self):
        result = self.run_pages([[self.row()], biz.FetchCancelled('stop')])
        self.assertEqual((result.status, result.exit_code), ('cancelled', 130))
        self.assertEqual(biz.recover_checkpoint(result.checkpoint)[0], list(result))

    def test_site_block_remains_three_and_is_not_retried(self):
        result = self.run_pages([[self.row()], biz.VerificationRequired(37, '验证')])
        self.assertEqual((result.status, result.exit_code), ('blocked', 3))


class SupplierTests(QuietTest):
    def arrange(self, codes):
        self.urls = [f'https://test-{i}.gys.cn/' for i in range(len(codes))]
        path = Path(self.directory) / '店铺.txt'
        path.write_text('\n'.join(self.urls), encoding='utf-8')
        replies = []
        for url, code in zip(self.urls, codes):
            org = {'@type': 'Organization', 'name': '测试公司', 'url': url}
            body = '<script type="application/ld+json">' + json.dumps(org) + '</script>'
            replies.append(types.SimpleNamespace(status_code=code, content=body.encode('utf-8')))
        self.http = self.stack.enter_context(mock.patch.object(supplier.requests, 'get', side_effect=replies))
        self.stack.enter_context(mock.patch.object(supplier.time, 'sleep'))
        return path

    def run_shops(self, path, **kwargs):
        return supplier.run_shops('both', input_path=path, outdir=self.directory, **kwargs)

    def test_all_success_keeps_zero(self):
        result = self.run_shops(self.arrange([200, 200, 200]))
        self.assertEqual((result.status, result.exit_code), ('completed', 0))
        self.assertEqual(set(result.paths), {'csv', 'json'})
        self.assertTrue(all(Path(p).exists() for p in result.paths.values()))

    def test_issue661_partial_http520_is_two_not_zero(self):
        result = self.run_shops(self.arrange([200, 200, 520]))
        self.assertEqual((result.status, result.exit_code), ('partial', 2))
        saved = json.loads(Path(result.paths['json']).read_text(encoding='utf-8'))
        self.assertEqual([row['status'] for row in saved], ['成功', '成功', '失败'])
        self.assertEqual(self.http.call_count, 3)
        self.assertIn('520', saved[-1]['error'])

    def test_all_http520_fail_without_retry(self):
        path = self.arrange([520, 520, 520])
        with self.assertRaises(supplier.SupplierError) as raised:
            self.run_shops(path)
        self.assertEqual(raised.exception.result.exit_code, 1)
        self.assertEqual(self.http.call_count, 3)

    def test_rate_limit_stops_later_requests(self):
        result = self.run_shops(self.arrange([200, 429, 200]))
        self.assertEqual((result.status, result.exit_code, len(result)), ('blocked', 3, 2))
        self.assertEqual(self.http.call_count, 2)

    def test_cancel_before_start_makes_no_requests(self):
        path = self.arrange([200])
        stop = threading.Event()
        stop.set()
        result = self.run_shops(path, stop_event=stop)
        self.assertEqual(result.exit_code, 130)
        self.http.assert_not_called()
        self.assertEqual(result.paths, {})

    def test_keyboard_interrupt_saves_preceding_rows(self):
        path = self.arrange([200, 200])
        first = next(self.http.side_effect)
        self.http.side_effect = [first, KeyboardInterrupt()]
        result = self.run_shops(path)
        self.assertEqual((len(result), result.exit_code), (1, 130))
        self.assertTrue(result.paths)

    def test_save_error_is_not_hidden_by_cancel(self):
        path = self.arrange([200, 200])
        first = next(self.http.side_effect)
        self.http.side_effect = [first, KeyboardInterrupt()]
        with mock.patch.object(supplier, 'export_subject_rows', side_effect=PermissionError('只读')):
            with self.assertRaises(PermissionError):
                self.run_shops(path)

    def test_real_auto_cli_passes_supplier_partial_code(self):
        path = self.arrange([200, 520])
        real = supplier.run_shops
        with mock.patch.object(tui, 'print_diagnostics'), mock.patch.object(tui.biz, 'close_owned_edge') as close, \
             mock.patch.object(supplier, 'run_shops', side_effect=lambda *a, **k: real(*a, **k, outdir=self.directory)):
            with self.assertRaises(SystemExit) as raised:
                tui.main(['--auto', 'shops', '--shops-file', str(path), '--format', 'both'])
        self.assertEqual(raised.exception.code, 2)
        close.assert_called_once()

    def test_tui_task_summary_is_partial_not_success(self):
        result = self.run_shops(self.arrange([200, 520]))
        runner = tui.TaskRunner()
        runner.start('供应商网', lambda: result)
        runner.wait()
        summary, _ = tui.task_summary(runner.task)
        self.assertIn('部分完成', summary)
        self.assertNotIn('已完成', summary)


if __name__ == '__main__':
    unittest.main(verbosity=2)
