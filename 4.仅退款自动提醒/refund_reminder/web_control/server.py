#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 该文件用于启动本地网页版后台并调度控制接口。
from __future__ import annotations

import json
import socket
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from ..browser_resolver import resolve_browser_executable
from ..control_service import ControlService
from ..logger import log
from ..runtime_maintenance import browser_runtime_arguments, build_runtime_layout, clean_browser_profile_cache, run_runtime_startup_maintenance
from ..runtime_paths import get_app_root, get_web_root
from .control_center_window_lifecycle import (
    ControlCenterBrowserHandle,
    close_browser_processes_by_profile,
    start_control_center_cleanup_watchdog,
    start_control_center_window_lifecycle_monitor,
)

_MODULE = "refund_reminder.web_control.server"


def _is_expected_client_disconnect(exc: BaseException | None) -> bool:
    # 该函数用于识别浏览器主动断开连接这类正常收尾。
    if exc is None:
        return False
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
        return True
    return isinstance(exc, OSError) and getattr(exc, "winerror", None) in {995, 10053, 10054}


def _find_free_port(start_port: int = 39480) -> int:
    # 该函数用于从固定端口向后寻找空位，避免重复启动时冲突。
    for port in range(int(start_port), int(start_port) + 30):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", port))
            return port
        except OSError:
            continue
        finally:
            sock.close()
    raise RuntimeError("本地后台端口都被占用，请先关闭冲突程序")


def _read_text(path: Path) -> bytes:
    # 该函数用于读取静态网页资源，统一 UTF-8 输出。
    return path.read_text(encoding="utf-8").encode("utf-8")


def _read_request_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    # 该函数用于统一读取 POST JSON 请求体。
    raw_length = int(handler.headers.get("Content-Length") or "0")
    raw_body = handler.rfile.read(raw_length) if raw_length > 0 else b"{}"
    try:
        return json.loads(raw_body.decode("utf-8") or "{}")
    except Exception as exc:
        raise RuntimeError(f"请求体不是合法 JSON：{exc}") from exc


def _read_required_bool(payload: dict[str, Any], key: str) -> bool:
    # 该函数用于接口层严格读取布尔值，避免字符串 false 被误当成 True。
    value = payload.get(key)
    if isinstance(value, bool):
        return value
    raise RuntimeError(f"请求参数错误：{key} 必须是布尔值")


def _write_json(handler: BaseHTTPRequestHandler, status_code: int, payload: dict[str, Any]) -> None:
    # 该函数用于统一输出 JSON，避免接口编码不一致。
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(int(status_code))
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _write_bytes(handler: BaseHTTPRequestHandler, status_code: int, content: bytes, content_type: str) -> None:
    # 该函数用于统一输出静态资源。
    handler.send_response(int(status_code))
    handler.send_header("Content-Type", content_type)
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(content)))
    handler.end_headers()
    handler.wfile.write(content)


def _open_control_center_browser(*, service: ControlService, root_dir: Path, url: str) -> ControlCenterBrowserHandle:
    # 该函数用于用独立浏览器资料目录打开后台，避免复用用户自己的窗口。
    executable = resolve_browser_executable(service.config.login.browser_executable)
    runtime_layout = build_runtime_layout(root_dir)
    user_data_dir = runtime_layout.control_center_profile_dir
    user_data_dir.mkdir(parents=True, exist_ok=True)
    close_browser_processes_by_profile(user_data_dir)
    clean_browser_profile_cache(user_data_dir)
    args = [
        str(executable),
        f"--user-data-dir={user_data_dir}",
        "--new-window",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--disable-background-mode",
        "--window-size=1480,960",
        *browser_runtime_arguments(),
        str(url),
    ]
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, creationflags=creationflags, close_fds=True)
    browser_handle = ControlCenterBrowserHandle(profile_dir=user_data_dir, process_id=int(process.pid or 0))
    log("Web", "启动后台浏览器", _MODULE, "_open_control_center_browser", executable=executable, profile=str(user_data_dir), control_browser_pid=browser_handle.process_id, url=url)
    start_control_center_cleanup_watchdog(browser_handle, shutdown_url=f"{url}/api/control/exit")
    service._append_log("后台网页已通过独立浏览器打开。")
    return browser_handle


class ReminderHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request: object, client_address: tuple[str, int] | str) -> None:
        # 该函数用于隐藏浏览器主动断连这类正常收尾，真实异常继续暴露。
        _exc_type, exc, _tb = sys.exc_info()
        if _is_expected_client_disconnect(exc):
            log("Web", "客户端连接已断开", _MODULE, "handle_error", client=str(client_address), reason=str(exc))
            return
        super().handle_error(request, client_address)


def create_server(*, service: ControlService, web_root: Path, port: int) -> ThreadingHTTPServer:
    # 该函数用于创建本地 HTTP 服务，提供后台静态资源和控制接口。
    assets = {
        "/": ("text/html; charset=utf-8", _read_text(web_root / "index.html")),
        "/button_feedback.js": ("application/javascript; charset=utf-8", _read_text(web_root / "button_feedback.js")),
        "/config_form.js": ("application/javascript; charset=utf-8", _read_text(web_root / "config_form.js")),
        "/order_card.js": ("application/javascript; charset=utf-8", _read_text(web_root / "order_card.js")),
        "/note_dialog.js": ("application/javascript; charset=utf-8", _read_text(web_root / "note_dialog.js")),
        "/order_board_helpers.js": ("application/javascript; charset=utf-8", _read_text(web_root / "order_board_helpers.js")),
        "/order_toggle_feedback.js": ("application/javascript; charset=utf-8", _read_text(web_root / "order_toggle_feedback.js")),
        "/order_board.js": ("application/javascript; charset=utf-8", _read_text(web_root / "order_board.js")),
        "/app.js": ("application/javascript; charset=utf-8", _read_text(web_root / "app.js")),
        "/style.css": ("text/css; charset=utf-8", _read_text(web_root / "style.css")),
        "/base.css": ("text/css; charset=utf-8", _read_text(web_root / "base.css")),
        "/layout_form.css": ("text/css; charset=utf-8", _read_text(web_root / "layout_form.css")),
        "/orders.css": ("text/css; charset=utf-8", _read_text(web_root / "orders.css")),
        "/note_dialog.css": ("text/css; charset=utf-8", _read_text(web_root / "note_dialog.css")),
        "/responsive.css": ("text/css; charset=utf-8", _read_text(web_root / "responsive.css")),
        "/favicon.ico": ("image/x-icon", b""),
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: object) -> None:
            # 该函数用于关闭 HTTP 默认访问日志，避免控制台被轮询请求刷屏。
            return

        def do_GET(self) -> None:
            # 该函数用于处理后台页面静态资源和状态查询。
            try:
                if self.path in assets:
                    content_type, content = assets[self.path]
                    _write_bytes(self, 200, content, content_type)
                    return
                if self.path == "/api/state":
                    _write_json(self, 200, service.get_snapshot())
                    return
                _write_json(self, 404, {"ok": False, "message": "未找到请求资源。"})
            except Exception as exc:
                log("Web", "请求失败", _MODULE, "do_GET", path=self.path, reason=str(exc))
                _write_json(self, 500, {"ok": False, "message": str(exc)})

        def do_POST(self) -> None:
            # 该函数用于处理后台页面发起的控制动作。
            try:
                if self.path == "/api/config/save":
                    config = service.save_form(_read_request_json(self))
                    _write_json(self, 200, {"ok": True, "message": "配置已保存。", "config": config, "form": service.get_form_state()})
                    return
                if self.path == "/api/browser/open":
                    service.open_erp_async()
                    _write_json(self, 200, {"ok": True, "message": "已开始打开 ERP，请在受控浏览器里完成登录。"})
                    return
                if self.path == "/api/monitor/start":
                    service.start_monitor(source="后台按钮：启动监控")
                    _write_json(self, 200, {"ok": True, "message": "自动监控已启动。"})
                    return
                if self.path == "/api/monitor/stop":
                    service.stop_monitor()
                    _write_json(self, 200, {"ok": True, "message": "自动监控正在停止。"})
                    return
                if self.path == "/api/orders/mark-handled":
                    order = service.mark_order_handled(str(_read_request_json(self).get("key") or ""))
                    _write_json(self, 200, {"ok": True, "message": "该订单已标记为人工处理，后续不再提醒。", "order": order, "runtime": service.get_snapshot()["runtime"]})
                    return
                if self.path == "/api/orders/set-handled":
                    payload = _read_request_json(self)
                    handled = _read_required_bool(payload, "handled")
                    order = service.set_order_handled(str(payload.get("key") or ""), handled=handled)
                    message = "该订单已标记为人工处理，后续不再提醒。" if handled else "该订单已恢复为未处理。"
                    _write_json(self, 200, {"ok": True, "message": message, "order": order, "runtime": service.get_snapshot()["runtime"]})
                    return
                if self.path == "/api/orders/set-verifying":
                    payload = _read_request_json(self)
                    verifying = _read_required_bool(payload, "verifying")
                    order = service.set_order_verifying(str(payload.get("key") or ""), verifying=verifying)
                    message = "该订单已移入正在核实。" if verifying else "该订单已恢复为未处理。"
                    _write_json(self, 200, {"ok": True, "message": message, "order": order, "runtime": service.get_snapshot()["runtime"]})
                    return
                if self.path == "/api/orders/set-processing":
                    payload = _read_request_json(self)
                    processing = _read_required_bool(payload, "processing")
                    order = service.set_order_processing(str(payload.get("key") or ""), processing=processing)
                    message = "该订单已标记为处理中。" if processing else "该订单已取消处理中。"
                    _write_json(self, 200, {"ok": True, "message": message, "order": order, "runtime": service.get_snapshot()["runtime"]})
                    return
                if self.path == "/api/orders/set-note":
                    payload = _read_request_json(self)
                    order = service.set_order_note(str(payload.get("key") or ""), note_text=str(payload.get("noteText") or ""))
                    message = "订单备注已保存。" if order.get("noteText") else "订单备注已清空。"
                    _write_json(self, 200, {"ok": True, "message": message, "order": order, "runtime": service.get_snapshot()["runtime"]})
                    return
                if self.path == "/api/control/exit":
                    service.exit_all()
                    _write_json(self, 200, {"ok": True, "message": "后台正在退出，会关闭本工具打开的窗口。"})
                    return
                _write_json(self, 404, {"ok": False, "message": "未找到请求资源。"})
            except Exception as exc:
                log("Web", "请求失败", _MODULE, "do_POST", path=self.path, reason=str(exc))
                _write_json(self, 500, {"ok": False, "message": str(exc)})

    return ReminderHTTPServer(("127.0.0.1", int(port)), Handler)


def main() -> int:
    # 该函数用于启动本地网页版后台，并在独立浏览器里打开控制页。
    root_dir = get_app_root()
    run_runtime_startup_maintenance(root_dir)
    service = ControlService(config_path=root_dir / "config.json")
    web_root = get_web_root()
    port = _find_free_port()
    server = create_server(service=service, web_root=web_root, port=port)
    url = f"http://127.0.0.1:{port}"
    stop_window_lifecycle_monitor = None
    threading.Thread(target=server.serve_forever, name="web-control-server", daemon=True).start()
    log("Web", "启动本地后台", _MODULE, "main", url=url)
    browser_handle = _open_control_center_browser(service=service, root_dir=root_dir, url=url)
    stop_window_lifecycle_monitor = start_control_center_window_lifecycle_monitor(service=service, browser_handle=browser_handle)
    service._append_log(f"本地后台地址：{url}")
    try:
        service.shutdown_event.wait()
    finally:
        if stop_window_lifecycle_monitor is not None:
            stop_window_lifecycle_monitor()
        server.shutdown()
        server.server_close()
        close_browser_processes_by_profile(browser_handle.profile_dir)
        clean_browser_profile_cache(browser_handle.profile_dir)
    return 0


__all__ = ["ReminderHTTPServer", "create_server", "main"]
