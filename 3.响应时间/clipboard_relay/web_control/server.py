#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import subprocess
import queue
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from ..browser_resolver import resolve_browser_executable
from ..logger import log
from ..runtime_cleanup import cleanup_shutdown_runtime_artifacts
from ..runtime_paths import get_app_root, get_web_root
from .control_center_window_lifecycle import (
    ControlCenterBrowserHandle,
    close_browser_processes_by_profile,
    start_control_center_cleanup_watchdog,
    start_control_center_window_lifecycle_monitor,
)
from .service import ControlCenterService

_MODULE = "clipboard_relay.web_control.server"


def _is_expected_client_disconnect(exc: BaseException | None) -> bool:
    # 该函数用于识别浏览器主动断开这类预期内异常，避免停止时黑窗误报崩溃。
    if exc is None:
        return False
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
        return True
    if isinstance(exc, OSError) and getattr(exc, "winerror", None) in {995, 10053, 10054}:
        return True
    return False


def _read_text(path: Path) -> bytes:
    # 该函数用于读取网页静态资源，统一 UTF-8 编码。
    return path.read_text(encoding="utf-8").encode("utf-8")


def _find_free_port(start_port: int = 39390) -> int:
    # 该函数用于从固定起始端口向后找空位，避免双击启动时端口冲突。
    for port in range(int(start_port), int(start_port) + 20):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", port))
            return port
        except OSError:
            continue
        finally:
            sock.close()
    raise RuntimeError("本地网页版后台端口全部被占用，请先关闭冲突程序。")


def _build_control_center_browser_args(*, executable: str, user_data_dir: Path, url: str) -> list[str]:
    # 该函数用于构造后台网页专用浏览器启动参数，确保不会复用用户当前浏览器。
    return [
        str(executable),
        f"--user-data-dir={user_data_dir}",
        "--new-window",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--disable-background-mode",
        "--disable-popup-blocking",
        "--window-size=1480,980",
        str(url),
    ]


def _open_control_center_browser(*, service: ControlCenterService, root_dir: Path, url: str) -> ControlCenterBrowserHandle:
    # 该函数用于用独立浏览器资料目录打开后台网页，避免干扰用户正在使用的浏览器。
    executable = resolve_browser_executable(service.config.login_flow)
    user_data_dir = root_dir / "runtime" / "browser_profiles" / "control_center"
    user_data_dir.mkdir(parents=True, exist_ok=True)
    close_browser_processes_by_profile(user_data_dir)
    args = _build_control_center_browser_args(executable=executable, user_data_dir=user_data_dir, url=url)
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    process = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
        close_fds=True,
    )
    browser_handle = ControlCenterBrowserHandle(profile_dir=user_data_dir, process_id=int(process.pid or 0))
    log("Web", "启动独立后台浏览器", _MODULE, "_open_control_center_browser", executable=executable, profile=str(user_data_dir), control_browser_pid=browser_handle.process_id, url=url)
    start_control_center_cleanup_watchdog(browser_handle, shutdown_url=f"{url}/api/control/exit")
    service._append_log("后台网页已通过独立浏览器打开，不会复用你当前正在使用的浏览器。")
    return browser_handle


def _read_request_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    # 该函数用于统一读取 POST JSON 请求体。
    raw_length = int(handler.headers.get("Content-Length") or "0")
    raw_body = handler.rfile.read(raw_length) if raw_length > 0 else b"{}"
    try:
        return json.loads(raw_body.decode("utf-8") or "{}")
    except Exception as exc:
        raise RuntimeError(f"请求体不是合法 JSON：{exc}") from exc


def _write_json(handler: BaseHTTPRequestHandler, status_code: int, payload: dict[str, Any]) -> None:
    # 该函数用于统一输出 JSON。
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


def _build_static_assets(web_root: Path) -> dict[str, tuple[str, bytes]]:
    # 该函数用于集中登记后台页面路由，避免新增页面时漏掉静态路径。
    home_page = _read_text(web_root / "index.html")
    assets = {
        "/": ("text/html; charset=utf-8", home_page),
        "/config": ("text/html; charset=utf-8", home_page),
        "/config/": ("text/html; charset=utf-8", home_page),
        "/config.html": ("text/html; charset=utf-8", home_page),
        "/logs": ("text/html; charset=utf-8", _read_text(web_root / "logs.html")),
        "/logs/": ("text/html; charset=utf-8", _read_text(web_root / "logs.html")),
        "/logs.html": ("text/html; charset=utf-8", _read_text(web_root / "logs.html")),
        "/app.js": ("application/javascript; charset=utf-8", _read_text(web_root / "app.js")),
        "/style.css": ("text/css; charset=utf-8", _read_text(web_root / "style.css")),
    }
    for script_path in sorted((web_root / "app").glob("*.js")):
        assets[f"/app/{script_path.name}"] = ("application/javascript; charset=utf-8", _read_text(script_path))
    for style_path in sorted((web_root / "styles").glob("*.css")):
        assets[f"/styles/{style_path.name}"] = ("text/css; charset=utf-8", _read_text(style_path))
    return assets


class RelayThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request: object, client_address: tuple[str, int] | str) -> None:
        # 该函数用于把浏览器主动断连当成正常收尾，避免停止时黑窗抛整段英文栈。
        _exc_type, exc, _tb = sys.exc_info()
        if _is_expected_client_disconnect(exc):
            log("Web", "客户端连接已断开", _MODULE, "handle_error", client=str(client_address), reason=str(exc))
            return
        super().handle_error(request, client_address)


def create_server(*, service: ControlCenterService, web_root: Path, port: int) -> ThreadingHTTPServer:
    # 该函数用于创建本地 HTTP 服务，给网页后台提供静态资源和接口。
    assets = _build_static_assets(web_root)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: object) -> None:
            return

        def do_GET(self) -> None:
            try:
                if self.path in assets:
                    content_type, content = assets[self.path]
                    _write_bytes(self, 200, content, content_type)
                    return
                if self.path == "/api/state":
                    _write_json(self, 200, service.get_snapshot())
                    return
                if self.path == "/api/events":
                    self.close_connection = True
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    channel = service.subscribe()
                    try:
                        runtime = service.get_snapshot()["runtime"]
                        try:
                            self.wfile.write(f"event: state\ndata: {json.dumps(runtime, ensure_ascii=False)}\n\n".encode("utf-8"))
                            self.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                            return
                        while not service.shutdown_event.is_set():
                            try:
                                event_name, payload = channel.get(timeout=1.0)
                            except queue.Empty:
                                try:
                                    self.wfile.write(b": ping\n\n")
                                    self.wfile.flush()
                                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                                    break
                                continue
                            data = json.dumps(payload.get("runtime", payload), ensure_ascii=False)
                            try:
                                self.wfile.write(f"event: {event_name}\ndata: {data}\n\n".encode("utf-8"))
                                self.wfile.flush()
                            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                                break
                            except OSError:
                                self.wfile.write(b": ping\n\n")
                                self.wfile.flush()
                    finally:
                        service.unsubscribe(channel)
                    return
                _write_json(self, 404, {"ok": False, "message": "未找到请求资源。"})
            except Exception as exc:
                log("Web", "请求失败", _MODULE, "do_GET", path=self.path, reason=str(exc))
                _write_json(self, 500, {"ok": False, "message": str(exc)})

        def do_POST(self) -> None:
            try:
                if self.path == "/api/config/save":
                    payload = _read_request_json(self)
                    config = service.save_form(payload)
                    _write_json(self, 200, {"ok": True, "message": "配置已保存。", "config": config, "form": service.get_form_state()})
                    return
                if self.path == "/api/config/save-buyer-urls":
                    payload = _read_request_json(self)
                    config = service.save_buyer_urls(payload)
                    _write_json(self, 200, {"ok": True, "message": "买家咨询店铺信息已保存。", "config": config, "form": service.get_form_state()})
                    return
                if self.path == "/api/config/save-credentials":
                    payload = _read_request_json(self)
                    config = service.save_credentials(payload)
                    _write_json(self, 200, {"ok": True, "message": "网页登录账号信息已保存。", "config": config, "form": service.get_form_state()})
                    return
                if self.path == "/api/login/prepare":
                    service.start_login_flow()
                    _write_json(self, 200, {"ok": True, "message": "网页登录准备流程已启动。"})
                    return
                if self.path == "/api/login/open-target":
                    payload = _read_request_json(self)
                    title = service.open_login_target(str(payload.get("target") or ""))
                    _write_json(self, 200, {"ok": True, "message": f"已打开{title}登录页，请在受控浏览器里完成登录。"})
                    return
                if self.path == "/api/control/start":
                    service.start_or_resume()
                    _write_json(self, 200, {"ok": True, "message": "已发送启动/继续信号。"})
                    return
                if self.path == "/api/control/pause":
                    service.pause_resume()
                    _write_json(self, 200, {"ok": True, "message": "已发送暂停/继续信号。"})
                    return
                if self.path == "/api/control/stop":
                    service.stop_all()
                    _write_json(self, 200, {"ok": True, "message": "已发送停止信号。"})
                    return
                if self.path == "/api/actions/open-startup-log":
                    path = service.open_startup_log_file()
                    _write_json(self, 200, {"ok": True, "message": "启动日志已打开。", "path": path})
                    return
                if self.path == "/api/control/exit":
                    service.exit_all()
                    _write_json(self, 200, {"ok": True, "message": "后台正在退出，会自动关闭本次打开的网页。"})
                    return
                _write_json(self, 404, {"ok": False, "message": "未找到请求资源。"})
            except Exception as exc:
                log("Web", "请求失败", _MODULE, "do_POST", path=self.path, reason=str(exc))
                _write_json(self, 500, {"ok": False, "message": str(exc)})

    return RelayThreadingHTTPServer(("127.0.0.1", int(port)), Handler)


def main() -> int:
    # 该函数用于启动本地网页版后台，并在独立浏览器里打开控制页。
    root_dir = get_app_root()
    service = ControlCenterService(config_path=root_dir / "config.json")
    web_root = get_web_root()
    port = _find_free_port()
    server = create_server(service=service, web_root=web_root, port=port)
    url = f"http://127.0.0.1:{port}"
    browser_handle: ControlCenterBrowserHandle | None = None
    stop_window_lifecycle_monitor = None
    threading.Thread(target=server.serve_forever, name="web-control-server", daemon=True).start()
    log("Web", "启动本地后台", _MODULE, "main", url=url)
    browser_handle = _open_control_center_browser(service=service, root_dir=root_dir, url=url)
    stop_window_lifecycle_monitor = start_control_center_window_lifecycle_monitor(service=service, browser_handle=browser_handle)
    service._append_log(f"本地网页版后台已启动：{url}")
    try:
        service.shutdown_event.wait()
    finally:
        if stop_window_lifecycle_monitor is not None:
            stop_window_lifecycle_monitor()
        server.shutdown()
        server.server_close()
        service.browser.force_kill_managed_browsers()
        if browser_handle is not None:
            close_browser_processes_by_profile(browser_handle.profile_dir)
        cleanup_shutdown_runtime_artifacts(root_dir)
    return 0


__all__ = ["RelayThreadingHTTPServer", "create_server", "main", "_build_control_center_browser_args", "_build_static_assets", "_is_expected_client_disconnect"]
