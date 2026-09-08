"""r5 回归：#654/#660/#662 的最小契约，不访问网站、不启动浏览器。"""
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

import boss_pagination as pagination
import boss_storage as storage
import jd_session


class StorageCompatibilityTests(unittest.TestCase):
    def test_status_manifest_is_ascii_compatible_utf8(self):
        result = types.SimpleNamespace(
            status='partial', requested_pages=2, completed_pages=1,
            failed_pages=[2], paths={'csv': '中文目录/结果.csv'},
            reason='第二页超时', missing_company_count=0,
        )
        result.__len__ = lambda self: 15
        # SimpleNamespace 的 __len__ 不能动态生效，使用小包装保持生产接口一致。
        class Outcome:
            status = result.status
            requested_pages = result.requested_pages
            completed_pages = result.completed_pages
            failed_pages = result.failed_pages
            paths = result.paths
            reason = result.reason
            missing_company_count = result.missing_company_count
            def __len__(self):
                return 15
        with tempfile.TemporaryDirectory(prefix='r5_中文_') as directory:
            store = storage.CheckpointStore(directory, '国内电商', '101280600', 2)
            try:
                store.finish(Outcome())
                raw = Path(store.path + '.status.json').read_bytes()
            finally:
                store.close()
        self.assertTrue(all(byte < 128 for byte in raw), raw[:100])
        data = json.loads(raw.decode('ascii'))
        self.assertEqual(data['reason'], '第二页超时')
        self.assertEqual(data['row_count'], 15)


class PaginationRegressionTests(unittest.TestCase):
    def test_document_scroll_replaces_failed_inner_container_strategy(self):
        self.assertIn('document.scrollingElement', pagination.SCROLL_ONCE_JS)
        self.assertIn('window.scrollTo', pagination.SCROLL_ONCE_JS)
        self.assertNotIn('candidates = new Set', pagination.SCROLL_ONCE_JS)

    def test_matching_prefetch_still_skips_scroll(self):
        current = types.SimpleNamespace(
            expected_joblist={'page': 2, 'query': '国内电商', 'city': '101280600'},
            joblist_requests={'R': {'page': ['2'], 'query': ['国内电商'], 'city': ['101280600']}},
            command=mock.Mock(),
        )
        pagination.advance_page(current)
        current.command.assert_called_once_with('Page.bringToFront')


class JdQualificationRoutingTests(unittest.TestCase):
    def test_legacy_qualification_url_maps_to_current_public_page(self):
        legacy = 'https://mall.jd.com/showLicence-123.html'
        current = 'https://mall.jd.com/shopLevel-123.html'
        self.assertEqual(jd_session._effective_target(legacy), current)
        self.assertTrue(jd_session._target_matches(legacy, current))
        self.assertFalse(jd_session._target_matches(
            'https://mall.jd.com/showLicence-456.html', current))

    def test_shop_level_captcha_is_treated_as_manual_verification(self):
        self.assertIn('shopLevel', jd_session.SNAPSHOT_JS)
        self.assertIn('qualificationChallenge', jd_session.SNAPSHOT_JS)
        self.assertIn('disclosureReady', jd_session.SNAPSHOT_JS)

    def test_reader_navigates_legacy_request_to_shop_level(self):
        legacy = 'https://mall.jd.com/showLicence-123.html'
        current = 'https://mall.jd.com/shopLevel-123.html'
        ready = {'url': current, 'ready': True, 'readyState': 'complete', 'blocked': False,
                 'text': '公司名称：测试企业', 'html': '<div>公司名称：测试企业</div>',
                 'iframeCount': 0, 'imageCount': 0}
        reader = jd_session.JdPageReader(verification_timeout=2)
        reader.session = mock.Mock(keep_open=False)
        reader.session.wait_response.return_value = {'result': {}}
        reader._snapshot = mock.Mock(side_effect=[ready, ready, ready])
        reader._pause = mock.Mock()
        with mock.patch.object(jd_session.time, 'monotonic', side_effect=[0, 0, 1.1]):
            page = reader.read(legacy)
        navigation = next(call for call in reader.session.send.call_args_list
                          if call.args[0] == 'Page.navigate')
        self.assertEqual(navigation.args[1]['url'], current)
        self.assertEqual(page['source_url'], current)


if __name__ == '__main__':
    unittest.main(verbosity=2)
