"""供应商网B2B店铺主体；只使用商家主页公开的结构化组织资料。"""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlsplit

import requests
from subject_export import RESULT_DIR, export_subject_rows

FIELDS = ['company', 'shop_url', 'platform', 'scope', 'certification', 'source_url', 'qualification_url', 'status', 'error']


class SupplierResult(list):
    """部分店铺失败不能以0退出；保留原list接口，供TUI和CLI共用。"""
    EXIT_CODES = {'completed': 0, 'partial': 2, 'blocked': 3, 'cancelled': 130, 'failed': 1}

    def __init__(self):
        super().__init__()
        self.status = 'completed'
        self.reason = ''
        self.paths = {}

    @property
    def exit_code(self):
        return self.EXIT_CODES[self.status]


class SupplierError(RuntimeError):
    def __init__(self, message, result):
        super().__init__(message)
        self.result = result


def normalize_shop_url(value):
    parts = urlsplit(value.strip())
    host = parts.hostname or ''
    if parts.scheme != 'https' or not re.fullmatch(r'[a-z0-9-]+\.gys\.cn', host) or host in {'www.gys.cn', 'm.gys.cn'}:
        raise ValueError('请填写 https://商家域名.gys.cn/ 格式的店铺网址')
    if parts.username or parts.password or parts.port not in (None, 443):
        raise ValueError('店铺网址不能包含账号或特殊端口')
    return f'https://{host}/'


class OrganizationParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.capturing = False
        self.parts = []
        self.documents = []

    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('type') == 'application/ld+json':
            self.capturing, self.parts = True, []

    def handle_data(self, data):
        if self.capturing:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.capturing:
            self.documents.append(json.loads(''.join(self.parts)))
            self.capturing = False


def parse_shop(document, shop_url):
    shop_url = normalize_shop_url(shop_url)
    parser = OrganizationParser()
    parser.feed(document)
    matches = []
    for document in parser.documents:
        nodes = document.get('@graph', [document]) if isinstance(document, dict) else document
        for node in nodes:
            if not isinstance(node, dict) or node.get('@type') != 'Organization':
                continue
            if urlsplit(node.get('url', '')).hostname != urlsplit(shop_url).hostname:
                continue
            name = str(node.get('name') or '').strip()
            if name:
                matches.append((name, node))
    if len(matches) != 1:
        raise ValueError('未发现唯一且与店铺域名对应的企业资料')
    name, organization = matches[0]
    certificates = organization.get('hasCertification', [])
    licensed = any(c.get('name') == '营业执照认证' and c.get('issuedBy', {}).get('name') == '供应商网' for c in certificates)
    return {
        'company': name, 'shop_url': shop_url, 'platform': '供应商网', 'scope': 'B2B商家店铺',
        'certification': '平台声明已核验营业执照' if licensed else '页面未披露营业执照认证',
        'source_url': shop_url, 'qualification_url': shop_url + 'certificates.html', 'status': '成功', 'error': '',
    }


def default_input_path():
    base = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).parent
    return base / '供应商网店铺清单.txt'


def run_shops(fmt='both', progress=None, input_path=None, outdir=RESULT_DIR, stop_event=None):
    if fmt not in ('csv', 'json', 'both'):
        raise ValueError('格式必须是 csv/json/both')
    path = Path(input_path) if input_path else default_input_path()
    values = [v.strip() for v in path.read_text(encoding='utf-8-sig').splitlines() if v.strip() and not v.lstrip().startswith('#')]
    urls = list(dict.fromkeys(normalize_shop_url(v) for v in values))
    if not urls:
        raise ValueError('店铺清单为空，请在供应商网店铺清单.txt中每行填写一家店铺网址')
    rows = SupplierResult()
    stopped = False
    blocked = False
    for index, url in enumerate(urls, 1):
        try:
            if stop_event is not None and stop_event.is_set():
                stopped = True
                break
            if index > 1:
                if stop_event is not None:
                    if stop_event.wait(1):
                        stopped = True
                        break
                else:
                    time.sleep(1)
            if callable(progress):
                progress(index - 1, len(urls), '采集供应商网店铺主体', f'{index}/{len(urls)}')
            response = requests.get(url, timeout=20, allow_redirects=False)
            if response.status_code != 200:
                blocked = response.status_code in (401, 403, 429)
                raise ValueError(f'店铺返回HTTP {response.status_code}，未取得主体；未自动重试')
            rows.append(parse_shop(response.content.decode('utf-8-sig'), url))
        except KeyboardInterrupt:
            stopped = True
            break
        except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
            rows.append(dict.fromkeys(FIELDS, ''))
            rows[-1].update(shop_url=url, platform='供应商网', scope='B2B商家店铺', source_url=url,
                            status='需要用户验证' if blocked else '失败', error=str(exc))
            print(f'[shops] {url} 未取得主体：{exc}', flush=True)
            if blocked:
                break  # 权限/验证/频率限制不继续请求后续店铺。
    if rows:
        rows.paths = export_subject_rows(rows, fmt, outdir, 'gys', FIELDS)
    failed = sum(row['status'] != '成功' for row in rows)
    success = len(rows) - failed
    if stopped:
        rows.status = 'cancelled'
    elif blocked:
        rows.status = 'blocked'
    elif not success:
        rows.status = 'failed'
    elif failed or len(rows) != len(urls):
        rows.status = 'partial'
    rows.reason = f'已处理{len(rows)}/{len(urls)}家，主体成功{success}家，失败{failed}家'
    print(f'[shops] {rows.reason}；status={rows.status}，退出码{rows.exit_code}', flush=True)
    if callable(progress):
        stage = {'completed': '完成', 'partial': '部分完成', 'blocked': '需要用户验证',
                 'cancelled': '已停止', 'failed': '失败'}[rows.status]
        progress(len(rows), len(urls), stage, rows.reason)
    if rows.status == 'failed':
        raise SupplierError('所有店铺均未取得主体，已导出失败原因', rows)
    return rows


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='从店铺清单获取供应商网B2B企业主体')
    parser.add_argument('--input', type=Path, default=default_input_path())
    parser.add_argument('--format', choices=['csv', 'json', 'both'], default='both')
    args = parser.parse_args()
    raise SystemExit(run_shops(args.format, input_path=args.input).exit_code)
