"""该文件负责自动下载任务和原系统页面动作，接口层只发起任务。"""
from __future__ import annotations

import inspect
import json
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .analysis import analyze_raw_tables
from .browser_control import close_download_browser_windows, wait_startup_cleanup
from .logging_utils import write_log
from .normalizers import normalize_phone
from .paths import ACTIVE_AUTO_DOWNLOAD_STATUSES, BASE_DIR, DOWNLOAD_CONFIG_FILE
from .raw_table_store import read_raw_tables
from .result_cache import save_latest_download_result
from .state_store import apply_followup_state, load_download_config

DOWNLOAD_TASKS: dict[str, dict[str, Any]] = {}


def parse_trailing_json_object(output_text: str, context: str) -> dict[str, Any]:
    """从带日志的进程输出中提取最后一个完整 JSON 对象。"""
    decoder = json.JSONDecoder()
    for match in re.finditer(r"{", output_text):
        start_index = match.start()
        try:
            payload, end_index = decoder.raw_decode(output_text[start_index:])
        except json.JSONDecodeError:
            continue
        if output_text[start_index + end_index :].strip():
            continue
        if not isinstance(payload, dict):
            raise RuntimeError(f"{context} 返回结果必须是对象")
        return payload
    raise RuntimeError(f"{context} 没有返回 JSON 结果：{output_text[-800:]}")


def open_loss_detail_browser(phone: str) -> dict[str, Any]:
    """复用 CDR 登录态打开原呼损明细页，并按号码写入查询条件。"""
    normalized_phone = normalize_phone(phone)
    if not normalized_phone:
        raise RuntimeError("打开呼损明细失败：号码不能为空")
    script_path = BASE_DIR / "automation" / "phone_loss_detail.js"
    write_log("打开明细", "呼损明细", f"号码={normalized_phone}")
    process = subprocess.run(
        ["node", str(script_path), str(DOWNLOAD_CONFIG_FILE), normalized_phone],
        cwd=str(BASE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        check=False,
    )
    output_text = ((process.stdout or "") + "\n" + (process.stderr or "")).strip()
    if process.returncode != 0:
        write_log("打开失败", "呼损明细", output_text[-300:])
        raise RuntimeError(f"打开呼损明细失败：{output_text[-800:]}")
    payload = parse_trailing_json_object(output_text, "打开呼损明细")
    if not payload.get("ok"):
        raise RuntimeError(f"打开呼损明细失败：{payload.get('message')}")
    write_log("打开完成", "呼损明细", f"号码={normalized_phone}")
    return payload


def open_original_system_login_browser() -> dict[str, Any]:
    """复用自动下载登录链路打开原电话系统，方便人工继续查询电话明细。"""
    script_path = BASE_DIR / "automation" / "phone_login_system.js"
    write_log("开始登录", "原电话系统", "打开并自动登录")
    process = subprocess.run(
        ["node", str(script_path), str(DOWNLOAD_CONFIG_FILE)],
        cwd=str(BASE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        check=False,
    )
    output_text = ((process.stdout or "") + "\n" + (process.stderr or "")).strip()
    if process.returncode != 0:
        write_log("登录失败", "原电话系统", output_text[-300:])
        raise RuntimeError(f"登录原电话系统失败：{output_text[-800:]}")
    payload = parse_trailing_json_object(output_text, "登录原电话系统")
    if not payload.get("ok"):
        raise RuntimeError(f"登录原电话系统失败：{payload.get('message')}")
    write_log("登录完成", "原电话系统", "已打开电话系统")
    return payload


def infer_auto_download_progress(log_text: str, current_progress: int | float = 0) -> tuple[str, int]:
    """根据自动化日志推断粗粒度进度，避免前端长时间没有可见反馈。"""
    progress_rules = [
        ("开始报表][呼损", "下载呼损明细", 12),
        ("导出下载][呼损", "导出呼损明细", 22),
        ("下载完成][loss=", "呼损明细已下载", 30),
        ("开始报表][呼入", "下载呼入明细", 36),
        ("导出下载][呼入", "导出呼入明细", 48),
        ("下载完成][inbound=", "呼入明细已下载", 58),
        ("开始报表][呼出", "下载呼出明细", 64),
        ("导出下载][呼出", "导出呼出明细", 76),
        ("下载完成][outbound=", "呼出明细已下载", 86),
    ]
    for marker, stage, progress in progress_rules:
        if marker in log_text:
            return stage, max(int(current_progress or 0), progress)
    return "自动下载", int(current_progress or 5)


def push_auto_download_task_log(task: dict[str, Any], output_lines: list[str], message: str, stage: str, progress: int) -> None:
    """把关键任务状态同时写入日志列表和状态字段，供前端轮询展示。"""
    frame = inspect.currentframe()
    caller = frame.f_back if frame else None
    line_number = caller.f_lineno if caller else 0
    timestamp = datetime.now().strftime("%H:%M:%S")
    output_lines.append(f"[{timestamp}][download_tasks.py:{line_number}][主线:自动下载][{stage}][{message}]")
    task["logs"] = output_lines[-80:]
    task["message"] = message
    task["stage"] = stage
    task["progress"] = max(int(task.get("progress") or 0), int(progress))


def find_active_auto_download_task() -> tuple[str, dict[str, Any]] | None:
    """查找正在控制电话系统页面的自动下载任务，避免多个流程互相抢页面。"""
    for task_id, task in DOWNLOAD_TASKS.items():
        if task.get("status") in ACTIVE_AUTO_DOWNLOAD_STATUSES:
            return task_id, task
    return None


def run_auto_download_task(task_id: str) -> None:
    """后台线程执行自动下载，并把日志持续写入任务状态，避免前端长时间无反馈。"""
    task = DOWNLOAD_TASKS[task_id]
    config = load_download_config()
    script_path = BASE_DIR / "automation" / "phone_download.js"
    task.update(
        {
            "status": "running",
            "message": f"开始下载最近{config['days']}天数据",
            "stage": "准备下载",
            "progress": 5,
            "logs": [],
        }
    )
    write_log("开始下载", "自动下载任务", f"任务={task_id}")
    try:
      # 启动清理线程会关闭下载浏览器残留进程，必须先等它完成再启动下载浏览器，
      # 否则浏览器会在下载中途被清理线程误杀，导致只下载一个文件就失败。
      task["stage"] = "等待启动清理"
      wait_startup_cleanup(timeout=60)
      process = subprocess.Popen(
          ["node", str(script_path), str(DOWNLOAD_CONFIG_FILE)],
          cwd=str(BASE_DIR),
          stdout=subprocess.PIPE,
          stderr=subprocess.STDOUT,
          text=True,
          encoding="utf-8",
          errors="replace",
      )
      task["pid"] = process.pid
      output_lines: list[str] = []
      assert process.stdout is not None
      for line in process.stdout:
          text = line.rstrip()
          if not text:
              continue
          output_lines.append(text)
          task["logs"] = output_lines[-80:]
          task["message"] = text
          stage, progress = infer_auto_download_progress(text, task.get("progress", 0))
          task["stage"] = stage
          task["progress"] = progress
          write_log("下载进度", "自动下载任务", text[-180:])
      exit_code = process.wait(timeout=5)
      output_text = "\n".join(output_lines)
      if exit_code != 0:
          raise RuntimeError(output_text[-1200:] or f"下载进程退出码={exit_code}")
      json_start = output_text.rfind("{")
      if json_start < 0:
          raise RuntimeError(f"自动下载没有返回结果：{output_text[-1200:]}")
      payload = json.loads(output_text[json_start:])
      if not payload.get("ok"):
          raise RuntimeError(str(payload.get("message") or "自动下载失败"))
      loss_path = Path(payload["lossFile"])
      inbound_path = Path(payload["inboundFile"])
      outbound_path = Path(payload["outboundFile"])
      push_auto_download_task_log(task, output_lines, "下载完成，正在读取Excel并分析记录", "分析记录", 90)
      write_log("开始分析", "自动下载任务", f"任务={task_id}")
      raw_tables = read_raw_tables(
          {"lossFile": loss_path, "inboundFile": inbound_path, "outboundFile": outbound_path}
      )
      result = apply_followup_state(analyze_raw_tables(raw_tables))
      result["rawTables"] = raw_tables
      result["downloadedFiles"] = {
          "lossFile": str(loss_path),
          "inboundFile": str(inbound_path),
          "outboundFile": str(outbound_path),
          "startDate": payload.get("startDate", ""),
          "endDate": payload.get("endDate", ""),
      }
      save_latest_download_result(
          result,
          {"lossFile": loss_path, "inboundFile": inbound_path, "outboundFile": outbound_path},
          "autoDownload",
      )
      close_download_browser_windows()
      task.update(
          {
              "status": "done",
              "message": "下载并分析完成",
              "stage": "完成",
              "progress": 100,
              "result": result,
              "finishedAt": time.time(),
          }
      )
      write_log("完成下载", "自动下载任务", f"任务={task_id} 候选={result['summary']['candidateCount']}")
    except Exception as error:
      task.update({"status": "error", "message": str(error), "stage": "失败", "progress": 100, "finishedAt": time.time()})
      write_log("下载失败", "自动下载任务", str(error)[-180:])
