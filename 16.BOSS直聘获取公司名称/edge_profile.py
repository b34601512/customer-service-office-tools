"""跨 Python 进程发现并复用 16 号项目的专用 Edge。

只复用命令行中明确使用本项目 PROFILE_DIR 的 Edge；不会扫描后直接接管任意 CDP。
新启动的端口会写入 profile 内的非敏感状态提示，旧版本启动的实例则在 Windows
上通过进程命令行回溯发现。状态文件不包含 Cookie、账号或页面内容。
"""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile

STATE_FILE = ".edge-instance.json"
STATE_VERSION = 1


def _normal_path(value):
    try:
        return os.path.normcase(os.path.abspath(os.path.expanduser(os.fspath(value)))).rstrip("\\/")
    except (TypeError, ValueError, OSError):
        return ""


def _state_path(profile_dir):
    return Path(profile_dir) / STATE_FILE


def _read_state(profile_dir):
    path = _state_path(profile_dir)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("version") != STATE_VERSION:
            return None
        port = int(data.get("port"))
        if not 1 <= port <= 65535:
            return None
        if _normal_path(data.get("profile_dir")) != _normal_path(profile_dir):
            return None
        return {"port": port, "pid": data.get("pid")}
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _remove_stale_state(profile_dir):
    try:
        _state_path(profile_dir).unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass


def remember_profile_edge(profile_dir, port, pid=None):
    """原子记录最后确认可用的专用 Edge 端口；失败不影响采集。"""
    try:
        directory = Path(profile_dir)
        directory.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({
            "version": STATE_VERSION,
            "profile_dir": _normal_path(profile_dir),
            "port": int(port),
            "pid": int(pid) if pid not in (None, "") else None,
        }, ensure_ascii=False, indent=2)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False,
                                         dir=directory, prefix=".edge-instance-", suffix=".tmp") as stream:
            stream.write(payload)
            temp_name = stream.name
        os.replace(temp_name, _state_path(profile_dir))
        return True
    except (OSError, ValueError, TypeError):
        try:
            if "temp_name" in locals():
                os.unlink(temp_name)
        except OSError:
            pass
        return False


def _command_arguments(command_line):
    if not command_line:
        return []
    try:
        values = shlex.split(str(command_line), posix=False)
    except ValueError:
        values = str(command_line).split()
    return [value[1:-1] if len(value) >= 2 and value[0] == value[-1] == '"' else value
            for value in values]


def _edge_command_candidate(command_line):
    """从 msedge 主进程命令行提取 (profile, port)；子进程没有端口参数会被忽略。"""
    arguments = _command_arguments(command_line)
    profile = None
    port = None
    for index, argument in enumerate(arguments):
        if argument.startswith("--user-data-dir="):
            profile = argument.split("=", 1)[1].strip('"')
        elif argument == "--user-data-dir" and index + 1 < len(arguments):
            profile = arguments[index + 1].strip('"')
        elif argument.startswith("--remote-debugging-port="):
            try:
                port = int(argument.split("=", 1)[1].strip('"'))
            except ValueError:
                return None
        elif argument == "--remote-debugging-port" and index + 1 < len(arguments):
            try:
                port = int(arguments[index + 1].strip('"'))
            except ValueError:
                return None
    if not profile or not port or not 1 <= port <= 65535:
        return None
    return profile, port


def _windows_edge_processes():
    """读取 Edge 主进程命令行。失败返回空列表，不把探测失败当采集失败。"""
    script = (
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"
        "$ErrorActionPreference='Stop';"
        "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
        "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
    )
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
             "-Command", script],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=False,
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        return []
    if result.returncode != 0 or not (result.stdout or "").strip():
        return []
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []
    if isinstance(data, dict):
        data = [data]
    return data if isinstance(data, list) else []


def discover_profile_edge(biz, preferred_port=None):
    """返回已运行且明确属于 biz.PROFILE_DIR 的 CDP 端口，否则返回 None。"""
    profile_dir = getattr(biz, "PROFILE_DIR", "")
    preferred = int(preferred_port or getattr(biz, "DEFAULT_PORT", 9222))
    state = _read_state(profile_dir)
    if state:
        if biz.cdp_ready(state["port"]):
            return state["port"]
        _remove_stale_state(profile_dir)

    if os.name != "nt":
        return None
    expected = _normal_path(profile_dir)
    candidates = []
    for process in _windows_edge_processes():
        if not isinstance(process, dict):
            continue
        parsed = _edge_command_candidate(process.get("CommandLine"))
        if not parsed:
            continue
        profile, port = parsed
        if _normal_path(profile) != expected:
            continue
        if biz.cdp_ready(port):
            candidates.append((0 if port == preferred else 1, abs(port - preferred), port,
                               process.get("ProcessId")))
    if not candidates:
        return None
    _, _, port, pid = min(candidates)
    remember_profile_edge(profile_dir, port, pid)
    return port


def resolve_profile_port(biz, preferred_port=None):
    """仅发现，不启动。适合在业务参数校验之前替换默认端口。"""
    preferred = int(preferred_port or getattr(biz, "DEFAULT_PORT", 9222))
    found = discover_profile_edge(biz, preferred)
    if found is not None and found != preferred:
        print(f"[browser] 发现已运行的专用 Edge，复用端口 {found}", flush=True)
    return found if found is not None else preferred


def ensure_profile_edge(biz, preferred_port=None, start_url="about:blank"):
    """优先复用专用 Profile 的现有 Edge；没有时才调用业务层启动新实例。"""
    preferred = int(preferred_port or getattr(biz, "DEFAULT_PORT", 9222))
    found = discover_profile_edge(biz, preferred)
    if found is not None:
        if hasattr(biz, "_preserved_edge_ports"):
            biz._preserved_edge_ports.add(found)
        print(f"[browser] 复用已运行的专用 Edge（端口 {found}）", flush=True)
        return found
    port = biz.ensure_edge_running(preferred, start_url=start_url)
    process = getattr(biz, "_owned_edge_processes", {}).get(port)
    remember_profile_edge(getattr(biz, "PROFILE_DIR", ""), port,
                          getattr(process, "pid", None) if process is not None else None)
    return port
