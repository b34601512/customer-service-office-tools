"""京东公开自营经营主体：解析、去重、导出，供CLI和TUI共同调用。"""
import argparse
import csv
from datetime import datetime
from html.parser import HTMLParser
import json
from pathlib import Path
from urllib.parse import urljoin

import requests

SOURCE_URL = 'https://in.m.jd.com/help/app/cardPhoto/cardPhotoList.html'
RESULT_DIR = Path.home() / '.boss-zhipin-scraper' / 'job-result'
FIELDS = ['company', 'platform', 'scope', 'regions', 'source_url', 'license_urls']


class SubjectParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.region = ''
        self.link = ''
        self.capture = None
        self.parts = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        if tag == 'a':
            self.link = urljoin(SOURCE_URL, attrs.get('href', ''))
        if tag == 'div' and 'text-list-title-block' in classes:
            self.capture, self.parts = 'region', []
        elif tag == 'span' and 'title' in classes and self.link:
            self.capture, self.parts = 'company', []

    def handle_data(self, text):
        if self.capture:
            self.parts.append(text)

    def handle_endtag(self, tag):
        if (self.capture == 'region' and tag == 'div') or (self.capture == 'company' and tag == 'span'):
            text = ''.join(self.parts).strip()
            if self.capture == 'region':
                self.region = text
            elif text:
                self.rows.append({'company': text, 'region': self.region, 'license_url': self.link})
            self.capture = None
        if tag == 'a':
            self.link = ''


def parse_subjects(document):
    if '京东商城自营商品经营者资质信息公示' not in document:
        raise ValueError('页面未出现经营主体公示标题，请核对来源页面')
    parser = SubjectParser()
    parser.feed(document)
    grouped = {}
    for entry in parser.rows:
        row = grouped.setdefault(entry['company'], {
            'company': entry['company'], 'platform': '京东', 'scope': '自营商品经营主体',
            'regions': [], 'source_url': SOURCE_URL, 'license_urls': [],
        })
        for key, value in [('regions', entry['region']), ('license_urls', entry['license_url'])]:
            if value and value not in row[key]:
                row[key].append(value)
    if not grouped:
        raise ValueError('未解析到公开经营主体，页面结构可能已变化')
    return list(grouped.values())


def export_subject_rows(rows, fmt, outdir, source, fields):
    if fmt not in ('csv', 'json', 'both'):
        raise ValueError('格式必须是 csv/json/both')
    directory = Path(outdir)
    directory.mkdir(parents=True, exist_ok=True)
    stem = 'merchant_subjects_' + source + '_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    for extension in (['csv', 'json'] if fmt == 'both' else [fmt]):
        path = directory / f'{stem}.{extension}'
        with path.open('x', encoding='utf-8-sig' if extension == 'csv' else 'utf-8', newline='') as output:
            if extension == 'json':
                json.dump(rows, output, ensure_ascii=False, indent=2)
            else:
                writer = csv.DictWriter(output, fieldnames=fields)
                writer.writeheader()
                writer.writerows({key: ' | '.join(value) if isinstance(value, list) else value for key, value in row.items()} for row in rows)
        print(f'[export] {extension.upper()} -> {path}', flush=True)


def run_subjects(fmt='both', progress=None, outdir=RESULT_DIR):
    if fmt not in ('csv', 'json', 'both'):
        raise ValueError('格式必须是 csv/json/both')
    if callable(progress):
        progress(0, 1, '读取京东公开经营主体', '正在读取官方证照公示')
    response = requests.get(SOURCE_URL, timeout=30)
    response.raise_for_status()
    rows = parse_subjects(response.content.decode('utf-8-sig'))
    export_subject_rows(rows, fmt, outdir, 'jd', FIELDS)
    print(f'[subjects] 已取得 {len(rows)} 个京东自营经营主体；区域与证照见导出文件。', flush=True)
    if callable(progress):
        progress(1, 1, '完成', f'{len(rows)} 个公开经营主体')
    return rows


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='京东公开自营经营主体导出')
    parser.add_argument('--format', choices=['csv', 'json', 'both'], default='both')
    run_subjects(parser.parse_args().format)
