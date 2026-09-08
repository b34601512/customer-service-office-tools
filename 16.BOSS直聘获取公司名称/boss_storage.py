"""结果文件与逐页检查点。网络失败不删除已落盘的数据，不从历史导出猜结果。"""
import csv
from datetime import datetime
import json
import os
from pathlib import Path
import tempfile
import uuid

CSV_FIELDS = ["company", "brand", "title", "salary", "location", "tags", "skills",
              "boss_name", "boss_title", "job_link", "job_id"]


def atomic_write(path, writer, encoding="utf-8"):
    """同目录临时文件完成后替换；异常时原文件保持不变。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding=encoding, newline="",
                                         dir=str(path.parent), prefix=".boss_",
                                         suffix=".tmp", delete=False) as stream:
            temp_path = Path(stream.name)
            writer(stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(str(temp_path), str(path))
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass


def csv_safe(value):
    # 网页文本是外部输入；CSV 用 Excel 打开时不能执行其中的公式。
    if isinstance(value, str):
        trimmed = value.lstrip(" \t\r\n")
        if value.startswith(("\t", "\r", "\n")) or trimmed.startswith(("=", "+", "-", "@")):
            return "'" + value
    return value


def export_rows(rows, keyword, city_code, fmt, outdir):
    if fmt not in ("csv", "json", "both"):
        raise ValueError(f"导出格式不支持：{fmt!r}")
    os.makedirs(outdir, exist_ok=True)
    part = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(keyword))[:32] or "keyword"
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    city_part = "".join(ch if ch.isalnum() else "_" for ch in str(city_code))[:32]
    stem = f"boss_jobs_{city_part}_{part}_{stamp}_{uuid.uuid4().hex}"
    paths = {}
    if fmt in ("csv", "both"):
        path = os.path.join(outdir, stem + ".csv")
        def write_csv(stream):
            writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: csv_safe(value) for key, value in row.items()})
        atomic_write(path, write_csv, encoding="utf-8-sig")
        paths["csv"] = path
    if fmt in ("json", "both"):
        path = os.path.join(outdir, stem + ".json")
        try:
            atomic_write(path, lambda stream: json.dump(list(rows), stream, ensure_ascii=False, indent=2))
        except BaseException as exc:
            exc.paths = dict(paths)
            # CSV 可能已保存；不删除它，调用方仍可从检查点恢复。
            if paths:
                print(f"[export] JSON 保存失败，CSV 已保留：{paths['csv']}", flush=True)
            raise
        paths["json"] = path
    return paths


class CheckpointStore:
    """一页一条 JSONL 事务，fsync 后再报告页完成；不自动重放网站翻页。"""
    def __init__(self, outdir, keyword, city_code, pages):
        folder = Path(outdir) / "checkpoints"
        folder.mkdir(parents=True, exist_ok=True)
        self.stream = tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=str(folder),
            prefix="boss_checkpoint_", suffix=".jsonl", delete=False)
        self.path = self.stream.name
        try:
            self._write({"version": 1, "keyword": keyword, "city": city_code, "requested_pages": pages})
        except BaseException:
            self.stream.close()
            raise

    def _write(self, payload):
        self.stream.write(json.dumps(payload, ensure_ascii=False) + "\n")
        self.stream.flush()
        os.fsync(self.stream.fileno())

    def write_page(self, page, rows):
        self._write({"page": page, "rows": list(rows)})

    def finish(self, result):
        # 清单和数据分别写，清单写失败不能使已保存页面消失。
        metadata = {"status": result.status, "row_count": len(result),
                    "requested_pages": result.requested_pages, "completed_pages": result.completed_pages,
                    "failed_pages": result.failed_pages, "paths": result.paths,
                    "reason": result.reason, "missing_company_count": result.missing_company_count}
        atomic_write(self.path + ".status.json",
                     lambda stream: json.dump(metadata, stream, ensure_ascii=False, indent=2))

    def close(self):
        self.stream.close()


def recover_checkpoint(path):
    """只恢复完整的逐页事务；末尾未写完的一行可以丢弃，中间损坏必须报错。"""
    rows, last_page = [], 0
    with open(path, "rb") as stream:
        header = json.loads(stream.readline())
        if not isinstance(header, dict) or header.get("version") != 1:
            raise ValueError("不支持的检查点格式")
        for line in stream:
            if not line.endswith(b"\n"):
                # 所有正常写入都有换行；断电留下的最后半行不是已提交页。
                break
            record = json.loads(line)
            page = record.get("page") if isinstance(record, dict) else None
            items = record.get("rows") if isinstance(record, dict) else None
            if (type(page) is not int or page <= last_page or not isinstance(items, list)
                    or any(not isinstance(row, dict) for row in items)):
                raise ValueError("检查点页结构或顺序损坏")
            rows.extend(items)
            last_page = page
    return rows, header
