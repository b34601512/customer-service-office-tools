"""京东页面会话：用户负责认证，程序读取完成认证后的页面。"""
import time
from urllib.parse import parse_qs, urlsplit

import boss_cdp
import edge_profile


class CollectionStopped(Exception):
    pass


class VerificationTimeout(TimeoutError):
    pass


class BrowserSessionError(RuntimeError):
    """专用 Edge/CDP 会话无法建立；属于共享基础设施故障，不是单个店铺缺字段。"""
    pass


# 验证页不读取HTML或账号输入；只返回认证状态。普通页面只读公开页面内容。
# showLicence 资质页可能在原 URL 内嵌图片验证码，因此不能只按 hostname/title 判断。
SNAPSHOT_JS = r'''(() => {
    const url = location.href, title = document.title;
    const text = document.body ? document.body.innerText : '';
    const path = location.pathname || '';
    const challengeText = /请.{0,8}(完成|进行).{0,8}(安全)?验证|拖动滑块|验证码|验证后查看|点击验证/.test(text);
    const challengeNode = !!document.querySelector(
        'input[name*=captcha i], input[id*=captcha i], input[class*=captcha i], ' +
        'input[name*=verify i], input[id*=verify i], img[class*=captcha i], ' +
        '[class*=verify-code i], [class*=verification i], [class*=captcha i]');
    const licenceChallenge = /\/showLicence-\d+\.html/i.test(path) && (challengeText || challengeNode);
    const blocked = /(^|\.)passport\.jd\.com$/.test(location.hostname)
        || /(^|\.)cfe\.m\.jd\.com$/.test(location.hostname)
        || /欢迎登录|京东验证|安全验证/.test(title)
        || /请完成安全验证|拖动滑块|请输入.{0,12}验证码/.test(text)
        || licenceChallenge;
    return {url, title, blocked, ready: document.readyState === 'complete',
        text: blocked ? '' : text,
        html: blocked ? '' : document.documentElement.outerHTML};
})()'''


def _target_matches(actual_url, expected_url):
    """允许站点追加无害查询参数，但目标 host/path 与请求参数必须保持一致。"""
    actual, expected = urlsplit(actual_url or ''), urlsplit(expected_url or '')
    if (actual.scheme, actual.hostname, actual.path) != (expected.scheme, expected.hostname, expected.path):
        return False
    expected_query = parse_qs(expected.query, keep_blank_values=True)
    actual_query = parse_qs(actual.query, keep_blank_values=True)
    return all(actual_query.get(key) == values for key, values in expected_query.items())


class JdPageReader:
    def __init__(self, stop_event=None, notify=None, verification_timeout=900):
        if verification_timeout < 1:
            raise ValueError('验证等待时间必须大于0秒')
        self.stop_event = stop_event
        self.notify = notify or (lambda stage, detail: None)
        self.verification_timeout = verification_timeout
        self.session = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        if self.session:
            self.session.close()

    def _check_stop(self):
        if self.stop_event is not None and self.stop_event.is_set():
            raise CollectionStopped('用户已停止采集')

    def _pause(self):
        if self.stop_event is not None:
            self.stop_event.wait(0.5)
        else:
            time.sleep(0.5)

    def _connect(self):
        if self.session is None:
            try:
                port = edge_profile.ensure_profile_edge(boss_cdp, boss_cdp.DEFAULT_PORT, start_url='about:blank')
                self.session = boss_cdp.CDPSession(boss_cdp.open_tab(port, url='about:blank'))
            except Exception as exc:
                self.session = None
                raise BrowserSessionError(
                    f'无法连接专用 Edge/CDP：{type(exc).__name__}: {exc}'
                ) from exc

    def _snapshot(self):
        mid = self.session.send('Runtime.evaluate', {'expression': SNAPSHOT_JS, 'returnByValue': True})
        response = self.session.wait_response(mid, timeout=2)
        if not response or 'error' in response or response.get('result', {}).get('exceptionDetails'):
            return None  # 导航切换执行上下文时下一轮继续读取。
        return response.get('result', {}).get('result', {}).get('value')

    def read(self, url):
        """单次导航；验证期间不刷新，不读取Cookie，不提交验证码。"""
        parts = urlsplit(url)
        if parts.scheme != 'https' or parts.hostname != 'mall.jd.com':
            raise ValueError('京东会话仅接受https://mall.jd.com页面')
        self._check_stop()
        self._connect()
        mid = self.session.send('Page.navigate', {'url': url})
        response = self.session.wait_response(mid, timeout=5)
        if response and ('error' in response or response.get('result', {}).get('errorText')):
            raise RuntimeError('京东页面导航失败')
        deadline = time.monotonic() + 30
        verifying = False
        ready_since = None
        return_navigation_sent = False
        while True:
            self._check_stop()
            now = time.monotonic()
            if now >= deadline:
                if verifying:
                    raise VerificationTimeout('等待用户验证超时，已停止后续店铺；重新采集即可重试')
                raise TimeoutError('京东页面加载超时')
            page = self._snapshot()
            if page:
                if page.get('blocked'):
                    ready_since = None
                    if not verifying:
                        verifying = True
                        deadline = now + self.verification_timeout
                        print('[jd] 需要用户验证：请在程序打开的Edge页面完成登录或验证码；程序会自动继续。', flush=True)
                        foreground = self.session.send('Page.bringToFront')
                        self.session.wait_response(foreground, timeout=1)
                    self.notify('等待用户验证', f'请在Edge完成验证，剩余{max(0, int(deadline-now))}秒；0/Ctrl+C停止并保存')
                else:
                    current_url = page.get('url', '')
                    if _target_matches(current_url, url) and page.get('ready') and (page.get('text') or page.get('html')):
                        if ready_since is None:
                            ready_since = now
                        if now - ready_since >= 1:
                            self.notify('继续采集', '用户验证已完成' if verifying else '页面读取完成')
                            return page
                    else:
                        ready_since = None
                        if verifying:
                            current = urlsplit(current_url)
                            # 登录完成后若落在京东首页，仅补发一次目标导航；验证页内始终不刷新。
                            if (page.get('ready') and current.hostname in ('mall.jd.com', 'www.jd.com')
                                    and not return_navigation_sent):
                                return_navigation_sent = True
                                mid = self.session.send('Page.navigate', {'url': url})
                                self.session.wait_response(mid, timeout=2)
                            self.notify('等待返回目标页面', '正在等待验证完成后返回采集页面')
            self._pause()
