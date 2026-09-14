"""直接调用电话漏接分析的底层自动下载任务（等价 TUI「7 下载」菜单）。

用法：python scripts/auto_download_and_analyze.py
"""
from __future__ import annotations

import os
import sys
import threading
import time
import uuid

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from missed_call_backend.download_tasks import DOWNLOAD_TASKS, run_auto_download_task  # noqa: E402


def main() -> int:
    task_id = uuid.uuid4().hex
    DOWNLOAD_TASKS[task_id] = {
        "status": "queued",
        "message": "任务已提交",
        "stage": "创建任务",
        "progress": 3,
        "logs": [],
    }
    worker = threading.Thread(target=run_auto_download_task, args=(task_id,), daemon=True)
    worker.start()

    printed = 0
    last_stage = ""
    while True:
        task = DOWNLOAD_TASKS.get(task_id, {})
        logs = task.get("logs") or []
        for line in logs[printed:]:
            print(line, flush=True)
        printed = len(logs)
        stage = str(task.get("stage") or "")
        if stage != last_stage:
            last_stage = stage
            print(f"[阶段] {stage} {task.get('progress')}% {task.get('message', '')}", flush=True)
        if task.get("status") in {"done", "error"}:
            break
        time.sleep(1)

    task = DOWNLOAD_TASKS.get(task_id, {})
    print("\n===== 下载任务结束 =====", flush=True)
    print(f"状态={task.get('status')} 阶段={task.get('stage')} 进度={task.get('progress')}%", flush=True)
    if task.get("status") == "error":
        print(f"失败原因={task.get('message')}", flush=True)
        return 1
    result = task.get("result") or {}
    summary = result.get("summary") or {}
    print("汇总：" + str({k: summary.get(k) for k in sorted(summary)}), flush=True)
    files = result.get("downloadedFiles") or {}
    print(f"时间范围={files.get('startDate')} ~ {files.get('endDate')}", flush=True)
    print(f"呼损文件={files.get('lossFile')}", flush=True)
    print(f"呼入文件={files.get('inboundFile')}", flush=True)
    print(f"呼出文件={files.get('outboundFile')}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
