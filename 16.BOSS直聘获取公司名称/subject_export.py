"""供应商网主体文件导出；不包含京东自营主体采集。"""
import csv
from datetime import datetime
import json
from pathlib import Path

RESULT_DIR = Path.home() / '.boss-zhipin-scraper' / 'job-result'


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
