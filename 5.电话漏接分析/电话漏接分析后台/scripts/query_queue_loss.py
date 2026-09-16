"""只读查询「今天/昨天」的排队呼损，并交叉核对呼入表是否已成功接通。

等价于 TUI：菜单7 下载完成后的「1 呼入」+「3 呼损」两张原始表的只读筛选查询。
只读取最近一次下载落地的 result.json，不重新下载、不修改任何数据。

用法：
    python scripts/query_queue_loss.py                 # 今天 + 昨天
    python scripts/query_queue_loss.py --date 2026-09-15
    python scripts/query_queue_loss.py --days 2         # 默认 2 天（今天+昨天）
    python scripts/query_queue_loss.py --stage all      # 不过滤丢失位置（含 IVR）
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
os.environ.setdefault("PYTHONIOENCODING", "utf-8")


class _Tee:
    """同时写控制台与报告文件，保证查询结果一定有一份落盘产物（不光在屏幕上）。"""

    def __init__(self, handle, stream) -> None:
        self._handle = handle
        self._stream = stream

    def write(self, text: str) -> int:
        self._handle.write(text)
        return self._stream.write(text)

    def flush(self) -> None:
        self._handle.flush()
        try:
            self._stream.flush()
        except Exception:  # pylint: disable=broad-except
            pass

    @property
    def encoding(self):  # 供 print 等判断编码
        return getattr(self._stream, "encoding", "utf-8")


def parse_dt(text: str):
    text = str(text or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def duration_seconds(text: str) -> int:
    """把 00:01:23 / 1分23秒 / 83 之类的时长文本转成秒。"""
    text = str(text or "").strip()
    if not text or text in {"-", "--"}:
        return 0
    if ":" in text:
        parts = [p for p in text.split(":") if p != ""]
        try:
            numbers = [int(float(p)) for p in parts]
        except ValueError:
            return 0
        seconds = 0
        for number in numbers:
            seconds = seconds * 60 + number
        return seconds
    total = 0
    current = ""
    for char in text:
        if char.isdigit():
            current += char
        elif char == "时" and current:
            total += int(current) * 3600
            current = ""
        elif char == "分" and current:
            total += int(current) * 60
            current = ""
        elif char == "秒" and current:
            total += int(current)
            current = ""
    return total


def load_latest_result() -> dict:
    pointer_path = os.path.join(BACKEND_DIR, "latest_download_result.json")
    with open(pointer_path, "r", encoding="utf-8") as handle:
        pointer = json.load(handle)
    result_path = pointer.get("resultFile") or os.path.join(pointer["recordDir"], "result.json")
    with open(result_path, "r", encoding="utf-8") as handle:
        result = json.load(handle)
    return {"pointer": pointer, "result": result}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default="", help="窗口结束日（默认今天）")
    parser.add_argument("--days", type=int, default=2, help="回看天数（默认2=今天+昨天）")
    parser.add_argument("--stage", default="queue", choices=["queue", "all"], help="queue=只看排队阶段")
    parser.add_argument("--no-report", action="store_true", help="不写报告文件（默认会写 runtime/queue_loss_report_<日期>.txt）")
    args = parser.parse_args()

    # 结果既打屏幕也落盘：报告路径固定按窗口结束日命名，方便次日对比与追溯。
    report_handle = None
    _原stdout = sys.stdout
    if not args.no_report:
        report_dir = os.path.join(BACKEND_DIR, "runtime")
        os.makedirs(report_dir, exist_ok=True)
        report_day = (args.date or date.today().isoformat()).replace("-", "")
        report_path = os.path.join(report_dir, f"queue_loss_report_{report_day}.txt")
        report_handle = io.open(report_path, "w", encoding="utf-8")
        sys.stdout = _Tee(report_handle, _原stdout)

    end_date = (
        datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else date.today()
    )
    start_date = end_date - timedelta(days=max(1, args.days) - 1)
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())

    payload = load_latest_result()
    result = payload["result"]
    raw = result.get("rawTables", {})
    loss_rows = raw.get("loss", [])
    inbound_rows = raw.get("inbound", [])
    files = result.get("downloadedFiles", {})

    print("=" * 72)
    print("排队呼损只读查询")
    print("=" * 72)
    print(f"数据记录：{payload['pointer'].get('recordId')}  下载时间：{payload['pointer'].get('savedAt')}")
    print(f"报表范围：{files.get('startDate')} ~ {files.get('endDate')}")
    print(f"统计窗口：{start_date} ~ {end_date}（{args.days} 天）｜阶段过滤：{args.stage}")
    print()

    # 呼入：某号码在该窗口内成功接通的记录（通话时长 > 0）
    success_by_phone: dict[str, list[dict]] = defaultdict(list)
    for row in inbound_rows:
        when = parse_dt(row.get("呼入时间"))
        if not when or not (start_dt <= when <= end_dt):
            continue
        talk = duration_seconds(row.get("通话时长"))
        if talk <= 0:
            continue
        success_by_phone[str(row.get("主叫号码") or "").strip()].append(
            {"time": when, "timeText": when.strftime("%Y-%m-%d %H:%M:%S"), "talk": talk}
        )
    for records in success_by_phone.values():
        records.sort(key=lambda item: item["time"])

    window_loss = []
    for row in loss_rows:
        when = parse_dt(row.get("来电时间"))
        if not when or not (start_dt <= when <= end_dt):
            continue
        stage = str(row.get("丢失位置") or "未知").strip() or "未知"
        is_queue = "排队" in stage
        window_loss.append(
            {
                "time": when,
                "timeText": when.strftime("%Y-%m-%d %H:%M:%S"),
                "phone": str(row.get("来电号码") or "").strip(),
                "did": str(row.get("DID号码") or "").strip(),
                "queue": str(row.get("队列号") or "").strip(),
                "stage": stage,
                "isQueue": is_queue,
                "ivr": duration_seconds(row.get("IVR停留")),
                "queueWait": duration_seconds(row.get("排队停留")),
                "city": str(row.get("归属地") or "未知").strip(),
                "handleTime": str(row.get("处理时间") or "").strip(),
                "handler": str(row.get("处理人") or "").strip(),
                "handleStatus": str(row.get("处理状态") or "").strip(),
            }
        )
    window_loss.sort(key=lambda item: item["time"])

    queue_loss = [r for r in window_loss if r["isQueue"]] if args.stage == "queue" else window_loss
    ivr_loss = [r for r in window_loss if not r["isQueue"]]

    print(f"窗口内呼损合计：{len(window_loss)} 条｜排队阶段：{len([r for r in window_loss if r['isQueue']])} 条｜"
          f"IVR/其他阶段：{len(ivr_loss)} 条")
    print()

    print("-" * 72)
    print(f"排队呼损明细（{len(queue_loss)} 条）")
    print("-" * 72)
    if not queue_loss:
        print("（该窗口内没有排队阶段呼损）")
    for index, record in enumerate(queue_loss, 1):
        success = [s for s in success_by_phone.get(record["phone"], []) if s["time"] > record["time"]]
        success_text = (
            f"呼损后已成功呼入 {success[-1]['timeText']}（通话{success[-1]['talk']}秒）"
            if success
            else "呼损后无成功呼入 → 需回访"
        )
        print(
            f"{index:>3}. {record['timeText']}｜{record['phone']}｜停留 排队{record['queueWait']}秒/"
            f"IVR{record['ivr']}秒｜队列{record['queue'] or '-'}｜DID {record['did'] or '-'}｜"
            f"{record['city']}｜处理状态:{record['handleStatus'] or '未处理'}"
            f"{('（' + record['handler'] + '）') if record['handler'] else ''}｜{success_text}"
        )
    print()

    need_callback = []
    for record in queue_loss:
        success = [s for s in success_by_phone.get(record["phone"], []) if s["time"] > record["time"]]
        if not success:
            need_callback.append(record)
    print("-" * 72)
    print(f"建议安排回访的排队呼损号码：{len(need_callback)} 个")
    print("-" * 72)
    seen: dict[str, dict] = {}
    for record in need_callback:
        if record["phone"] not in seen:
            seen[record["phone"]] = record
    if not seen:
        print("（无：窗口内排队呼损客户均已在呼损后成功呼入）")
    for phone, record in seen.items():
        print(f"  {phone}｜来电 {record['timeText']}｜排队停留 {record['queueWait']} 秒｜{record['city']}｜DID {record['did'] or '-'}")
    print()

    if ivr_loss:
        print("-" * 72)
        print(f"同窗口 IVR/其他阶段呼损（{len(ivr_loss)} 条，仅参考，不算排队呼损）")
        print("-" * 72)
        for record in ivr_loss:
            print(f"  {record['timeText']}｜{record['phone']}｜{record['stage']}｜停留{record['ivr']}秒｜{record['city']}")
        print()

    if report_handle is not None:
        # 先把 stdout 还原，再关文件，否则收尾这句会写到已关闭的文件上（2026-09-16 实际踩到）。
        sys.stdout = _原stdout
        sys.stdout.flush()
        report_handle.close()
        print(f"报告已写入：{report_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
