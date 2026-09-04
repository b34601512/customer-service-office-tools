#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
boss_cdp.py —— BOSS直聘职位/公司名自动采集（Edge CDP 方案，可复用工具）

依据仓库 issue #636「BOSS直聘职位数据自动采集」完整经验实现：
  - 不抓 DOM，不用 Selenium/Playwright（受控浏览器指纹明显，极易验证码）
  - 独立 Microsoft Edge 实例（独立 user-data-dir + CDP 调试端口 + --remote-allow-origins=*）
  - 人工扫码登录一次，登录态永久保存在该 profile，后续不再登录
  - CDP 监听页面自身发出的 /wapi/zpgeek/search/joblist.json 响应，解析明文 JSON（绕开字体反爬）
  - 低频抓取（默认页间隔 3 秒），逐页收集，单页异常不影响其他页

用法：
  python boss_cdp.py setup          # 启动专用 Edge 并等待登录
  python boss_cdp.py fetch --keyword "国内电商" --city 深圳 --pages 2 --format csv

依赖：requests、websocket-client（见 requirements.txt）
由 CLI、TUI 与外部调用共享同一组业务函数。
"""

import argparse
import csv
import json
from datetime import datetime
import os
import socket
import subprocess
import sys
import time
import urllib.parse

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests
from websocket import create_connection, WebSocketTimeoutException

# ---------------------------------------------------------------- launcher（模块1）

EDGE_CANDIDATES = [
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
]

DEFAULT_PORT = 9222
# 独立 profile = 持久登录态（踩坑2：必须独立 user-data-dir，默认 profile 无法开调试端口）
PROFILE_DIR = os.path.join(os.path.expanduser("~"), ".boss-zhipin-scraper", "edge-profile")
RESULT_DIR = os.path.join(os.path.expanduser("~"), ".boss-zhipin-scraper", "job-result")

# 仅记录当前 Python 进程实际启动的 Edge；端口已有实例时不登记、不负责关闭。
_owned_edge_processes = {}

JOBLIST_PATH_PART = "/wapi/zpgeek/search/joblist.json"
SEARCH_PAGE_URL = "https://www.zhipin.com/web/geek/job"

# 常用城市码（全量码表：/wapi/zpCommon/data/cityGroup.json）
CITY_CODES = {
    "北京": "101010100", "上海": "101020100", "天津": "101030100", "重庆": "101040100",
    "广州": "101280100", "深圳": "101280600", "杭州": "101210100", "南京": "101190100",
    "苏州": "101190400", "无锡": "101190200", "宁波": "101210400", "成都": "101270100",
    "武汉": "101200100", "西安": "101110100", "长沙": "101250100", "郑州": "101180100",
    "济南": "101120100", "青岛": "101120200", "福州": "101230100", "厦门": "101230200",
    "东莞": "101281600", "佛山": "101280800", "合肥": "101220100", "大连": "101070200",
}

CSV_FIELDS = [
    "company", "title", "salary", "location", "tags", "skills",
    "boss_name", "boss_title", "job_link", "job_id",
]


def find_edge():
    for path in EDGE_CANDIDATES:
        if os.path.exists(path):
            return path
    raise FileNotFoundError("未找到 Microsoft Edge，请确认系统 Edge 已安装")


def cdp_ready(port, timeout=2):
    try:
        r = requests.get(f"http://127.0.0.1:{port}/json/version", timeout=max(0.1, float(timeout)))
        return r.status_code == 200
    except Exception:
        return False


def find_free_port(preferred=DEFAULT_PORT):
    """从首选端口开始寻找本机可绑定的回环端口，避开其他本地服务。"""
    preferred = int(preferred)
    if preferred <= 0:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])
    for candidate in range(preferred, preferred + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", candidate))
            except OSError:
                continue
            return candidate
    raise OSError(f"从端口 {preferred} 开始没有找到可用端口")


def ensure_edge_running(port=DEFAULT_PORT):
    """启动独立 Edge；若首选端口被占用则自动换用可用端口。返回实际端口。"""
    requested_port = int(port)
    if cdp_ready(requested_port):
        return requested_port  # 已运行，复用
    os.makedirs(PROFILE_DIR, exist_ok=True)
    os.makedirs(RESULT_DIR, exist_ok=True)
    browser_path = find_edge()
    active_port = find_free_port(requested_port)
    if active_port != requested_port:
        print(f"[browser] 端口 {requested_port} 已被占用，改用端口 {active_port}…", flush=True)
    cmd = [
        browser_path,
        f"--remote-debugging-port={active_port}",
        f"--user-data-dir={PROFILE_DIR}",
        "--remote-allow-origins=*",   # 踩坑2：不加则 CDP 握手被拒
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        SEARCH_PAGE_URL,
    ]
    print("[browser] 启动 Microsoft Edge…", flush=True)
    try:
        process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Microsoft Edge 启动失败：{exc}") from exc
    _owned_edge_processes[active_port] = process
    for _ in range(60):  # 最多等 30 秒
        if cdp_ready(active_port):
            print("[browser] 已使用 Microsoft Edge", flush=True)
            return active_port
        # 进程已经自行退出时直接报错，不再空等 30 秒。
        if process.poll() is not None:
            break
        time.sleep(0.5)
    # 启动失败也要收掉本次留下的 Edge 进程，避免半启动残留。
    close_owned_edge(active_port)
    raise TimeoutError("Microsoft Edge 的 CDP 调试端口未就绪，请检查 Edge 是否可正常启动")


def _close_browser_via_cdp(port):
    """通过本次实例自己的 CDP 端口关闭整个 Edge，而不是只关一个标签页。"""
    ws = None
    try:
        response = requests.get(f"http://127.0.0.1:{port}/json/version", timeout=1)
        if response.status_code != 200:
            return False
        ws_url = response.json().get("webSocketDebuggerUrl")
        if not ws_url:
            return False
        ws = create_connection(ws_url, timeout=1)
        ws.send(json.dumps({"id": 1, "method": "Browser.close", "params": {}}))
        return True
    except Exception:
        return False
    finally:
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass


def _wait_for_cdp_closed(port, timeout=2):
    """短暂确认指定 CDP 端口已消失，避免退出因网络探测等待很久。"""
    timeout = max(0.1, float(timeout))
    deadline = time.time() + timeout
    while time.time() < deadline:
        remaining = max(0.1, deadline - time.time())
        if not cdp_ready(port, timeout=min(0.5, remaining)):
            return True
        time.sleep(min(0.1, remaining))
    return not cdp_ready(port, timeout=0.5)


def _terminate_process_tree(pid):
    """按 12 号项目的策略终止进程树；Windows 下覆盖浏览器的全部子进程。"""
    if os.name == "nt":
        try:
            result = subprocess.run(
                ["taskkill.exe", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=3,
                check=False,
            )
        except (OSError, subprocess.SubprocessError, ValueError):
            return False
        # 进程已自行退出时 taskkill 可能返回非 0，这不应阻断退出清理。
        return result.returncode == 0

    try:
        os.kill(pid, 15)
    except (ProcessLookupError, PermissionError):
        pass
    return True


def _close_owned_edge_port(port):
    process = _owned_edge_processes.pop(port, None)
    if process is None:
        return False
    pid = int(process.pid)
    try:
        # 端口对应的就是本次启动的 Edge，即使 Edge 主进程已脱离 Popen PID，
        # Browser.close 仍能关闭真正的浏览器窗口。
        if _close_browser_via_cdp(port) and _wait_for_cdp_closed(port, timeout=2):
            return True
        # CDP 关闭失败时只对本次登记的 PID 做一次有上限的进程树清理。
        _terminate_process_tree(pid)
        _wait_for_cdp_closed(port, timeout=1)
    except Exception as exc:  # noqa: BLE001
        print(f"[edge] 退出清理失败（PID={pid}）：{exc}", file=sys.stderr)
    return True


def close_owned_edge(port=None):
    """关闭本进程启动的专用 Edge；不传端口时清理本进程登记的全部实例。"""
    if port is not None:
        return _close_owned_edge_port(int(port))
    ports = list(_owned_edge_processes)
    closed = False
    for active_port in ports:
        closed = _close_owned_edge_port(active_port) or closed
    return closed


def open_tab(port=DEFAULT_PORT):
    """新建一个标签页并返回其 webSocketDebuggerUrl。现代 Chromium 需 PUT。"""
    for method in (requests.put, requests.get):
        try:
            r = method(f"http://127.0.0.1:{port}/json/new?{urllib.parse.urlencode({'url': SEARCH_PAGE_URL})}", timeout=5)
            if 200 <= r.status_code < 300:
                info = r.json()
                tab = next(t for t in info if t.get("type") == "page") if isinstance(info, list) else info
                return tab["webSocketDebuggerUrl"]
        except Exception:
            continue
    raise RuntimeError("无法创建 CDP 标签页")


# ---------------------------------------------------------------- cdp session

class CDPSession:
    """websocket-client 对 CDP 的最小封装（域事件监听 + 带 id 的请求响应）。"""

    def __init__(self, ws_url, timeout=60):
        self.ws = create_connection(ws_url, timeout=timeout)
        self._id = 0
        self._pending = {}

    def send(self, method, params=None):
        self._id += 1
        mid = self._id
        self._pending[mid] = None
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        return mid

    def _recv_json(self, timeout):
        """按调用方超时读取一条 CDP 消息，避免连接初始化的 60 秒超时覆盖业务超时。"""
        previous_timeout = self.ws.gettimeout()
        self.ws.settimeout(max(0.1, float(timeout)))
        try:
            return json.loads(self.ws.recv())
        except WebSocketTimeoutException:
            return None
        finally:
            self.ws.settimeout(previous_timeout)

    def wait_response(self, mid, timeout=30):
        """等待指定 id 的 response（期间消费事件）。返回响应 dict 或 None。"""
        # recv_event 可能已经先收到了该 response；不能只在 websocket 中继续等。
        cached = self._pending.pop(mid, None)
        if cached is not None:
            return cached
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self._recv_json(min(1, max(0.1, deadline - time.time())))
            if msg is None:
                continue
            if "id" in msg:
                if msg["id"] == mid:
                    self._pending.pop(mid, None)
                    return msg
                # 保留其他命令的 response，避免被当前等待消费后永久丢失。
                self._pending[msg["id"]] = msg
                continue
            self._handle_event(msg)
        return None

    def recv_event(self, timeout=30):
        """阻塞收一条事件消息；返回事件 dict 或 None（按传入超时返回）。"""
        msg = self._recv_json(timeout)
        if msg is None:
            return None
        if "id" in msg:
            self._pending[msg["id"]] = msg
            return None
        return msg

    def close(self):
        # open_tab() 创建的是本次任务专用标签页；关闭 WebSocket 不会自动关闭标签页。
        # 先请求 CDP 关闭当前页面，避免每次抓取残留 about:blank。
        try:
            mid = self.send("Page.close")
            self.wait_response(mid, timeout=2)
        except Exception:
            pass
        try:
            self.ws.close()
        except Exception:
            pass

    # -- 域事件过滤 --
    @staticmethod
    def _handle_event(msg):
        method = msg.get("method", "")
        if method == "Network.responseReceived" and JOBLIST_PATH_PART in msg.get("params", {}).get("response", {}).get("url", ""):
            _joblist_responses.append(msg["params"])


# 进程级缓存：命中 joblist 的 Network.responseReceived 参数
_joblist_responses = []


# ---------------------------------------------------------------- response parsing

def response_job_list(data):
    """兼容 BOSS joblist 接口的新旧响应结构，返回统一岗位列表。"""
    if not isinstance(data, dict):
        return []
    # 当前接口结构优先；旧字段偶尔可能同时存在但为空。
    zp_data = data.get("zpData")
    if isinstance(zp_data, dict) and isinstance(zp_data.get("jobList"), list):
        return zp_data["jobList"]
    if isinstance(data.get("zpList"), list):
        return data["zpList"]
    if isinstance(data.get("jobList"), list):
        return data["jobList"]
    return []


# ---------------------------------------------------------------- login_wait（模块2）

def login_wait(keyword, city_code, port=DEFAULT_PORT, login_timeout=900, progress=None):
    """只导航一次到搜索页，未登录时保持登录页不动，监听登录后的 joblist 响应。"""
    try:
        login_timeout = max(1, int(login_timeout))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"登录等待时间必须是整数：{login_timeout!r}") from exc
    session = _new_session(port)
    try:
        session.send("Network.enable")
        session.send("Page.enable")
        url = search_url(keyword, city_code, 1)
        deadline = time.time() + login_timeout
        print("[login] 请在弹出的 Microsoft Edge 窗口中完成扫码/验证码登录（若已登录可忽略）…")
        # 只导航一次：未登录时页面会由 BOSS 自己停留/跳转到登录入口；
        # 后续只监听这个页面的网络事件，绝不循环刷新或重复 Page.navigate。
        _joblist_responses.clear()
        session.send("Page.navigate", {"url": url})
        print("[login] 登录等待中：浏览器页面保持不动，请直接在窗口内完成登录…")
        while time.time() < deadline:
            remaining = max(1, int(deadline - time.time()))
            data = _await_joblist(
                session,
                timeout=min(30, remaining),
                progress_message="[login] 等待登录后的岗位响应",
                progress=progress,
                progress_total=0,
                progress_stage="等待登录响应",
            )
            if data is not None:
                code = data.get("code")
                if code == 0:
                    # 登录态判断只看接口成功码，不依赖岗位数量；合法搜索结果可以为空。
                    count = len(response_job_list(data))
                    print(f"[login] 登录态有效（本次搜索返回 {count} 条岗位），已持久化到专用 profile。")
                    return True
                if code == 37:
                    print("[login] code:37 环境异常——请确认走的是已登录专用 Edge，勿直连 API。")
            # 未登录时只等待事件，不重新加载页面，避免登录页反复抽搐。
        print(f"[login] 超时（{login_timeout}s）。请检查窗口内确认登录状态后重试。")
        return False
    finally:
        # 成功、超时、CDP 异常都关闭本次登录临时标签页。
        session.close()


# ---------------------------------------------------------------- fetch（模块3）

def search_url(keyword, city_code, page):
    parts = [
        ("query", keyword),
        ("city", city_code),
        ("page", str(page)),
    ]
    return f"{SEARCH_PAGE_URL}?" + urllib.parse.urlencode(parts)


def _new_session(port):
    return CDPSession(open_tab(port))


def _joblist_response_data(session, params):
    """读取一条 joblist 响应；响应体尚未就绪时短暂重试，避免丢掉真实岗位数据。"""
    request_id = params.get("requestId")
    if not request_id:
        return None
    for attempt in range(3):
        body, _ = _get_body(session, request_id, timeout=5)
        if body:
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                return None
        if attempt < 2:
            time.sleep(0.2)
    return None


def _await_joblist(session, timeout=60, progress_message="", progress=None,
                   progress_current=0, progress_total=0, progress_stage="等待网络响应"):
    """等待 joblist 响应并取回 body 解析；按秒返回控制权，保证界面持续有状态。"""
    deadline = time.time() + timeout
    last_progress = 0.0
    while time.time() < deadline:
        # wait_response 取 body 时可能顺便消费其他 Network 事件，先处理缓存队列，避免漏响应。
        if _joblist_responses:
            params = _joblist_responses.pop(0)
            data = _joblist_response_data(session, params)
            if data is not None:
                return data

        remaining = max(0.1, deadline - time.time())
        msg = session.recv_event(timeout=min(1, remaining))
        if msg is not None:
            method = msg.get("method")
            params = msg.get("params", {})
            if method == "Network.responseReceived":
                resp = params.get("response", {})
                if JOBLIST_PATH_PART in resp.get("url", ""):
                    data = _joblist_response_data(session, params)
                    if data is not None:
                        return data

        elapsed = int(time.time() - (deadline - timeout))
        if callable(progress):
            progress(progress_current, progress_total, progress_stage, f"已等待 {elapsed}s")
        if progress_message and time.time() - last_progress >= 10:
            print(f"{progress_message}（已等待 {elapsed}s）", flush=True)
            last_progress = time.time()
    return None


def _get_body(session, request_id, timeout=20):
    mid = session.send("Network.getResponseBody", {"requestId": request_id})
    resp = session.wait_response(mid, timeout=timeout)
    if resp and "error" not in resp:
        r = resp["result"]
        body = r.get("body", "")
        if r.get("base64Encoded"):
            import base64
            body = base64.b64decode(body).decode("utf-8", "replace")
        return body, r.get("base64Encoded", False)
    return None, False


def parse_job(item):
    """把岗位单条转成统一 job dict（公司名/岗位/薪资/地区/链接）。"""
    if not isinstance(item, dict):
        raise ValueError("岗位数据必须是对象")

    def _join(value):
        if isinstance(value, (list, tuple)):
            return ",".join(str(x) for x in value if x not in (None, ""))
        return "" if value in (None, "") else str(value)

    def _g(*keys):
        for k in keys:
            v = item.get(k)
            if v not in (None, ""):
                return _join(v)
        return ""

    location = "·".join(_join(x) for x in (item.get("cityName"), item.get("areaDistrict"),
                                            item.get("businessDistrict")) if x not in (None, ""))
    ejid = item.get("encryptJobId") or item.get("jobId")
    tags = _join(item.get("jobLabels"))
    skills = _join(item.get("skills"))
    return {
        "company": _g("brandName", "brandNameAlias"),
        "title": _g("jobName", "jobTitle"),
        "salary": _g("salaryDesc"),
        "location": location,
        "tags": tags,
        "skills": skills,
        "boss_name": _g("bossName"),
        "boss_title": _g("bossTitle"),
        "job_link": f"https://www.zhipin.com/job_detail/{ejid}.html" if ejid else "",
        "job_id": _g("jobId", "encryptJobId"),
    }


def fetch_page(session, keyword, city_code, page, page_delay=3, total_pages=0, progress=None):
    """导航到第 page 页并解析 joblist 数据。返回 row 列表。"""
    _joblist_responses.clear()
    if callable(progress):
        progress(page - 1, total_pages, f"打开第 {page}/{total_pages} 页" if total_pages else f"打开第 {page} 页", "正在导航到搜索结果页")
    print(f"[fetch] 第 {page} 页：正在打开搜索结果并等待接口响应…", flush=True)
    session.send("Page.navigate", {"url": search_url(keyword, city_code, page)})
    data = _await_joblist(
        session,
        timeout=60,
        progress_message=f"[fetch] 第 {page} 页仍在等待 joblist 响应",
        progress=progress,
        progress_current=page - 1,
        progress_total=total_pages,
        progress_stage=f"等待第 {page}/{total_pages} 页响应" if total_pages else f"等待第 {page} 页响应",
    )
    if data is None:
        raise TimeoutError(
            f"第 {page} 页未捕获到 joblist 响应（可能网络超时、CDP监听时序、登录失效或风控）"
        )
    if data.get("code") != 0:
        raise RuntimeError(f"第 {page} 页返回 code:{data.get('code')} {data.get('message', '')}")
    rows = [parse_job(x) for x in response_job_list(data)]
    # 只在还有下一页时等待，最后一页不做无意义停顿。
    if page_delay > 0 and (not total_pages or page < total_pages):
        time.sleep(page_delay)  # 低频，避免封号
    return rows


# ---------------------------------------------------------------- export（模块4）

def export_rows(rows, keyword, city_code, fmt, outdir=RESULT_DIR):
    """把本次已收集结果写入 CSV/JSON；返回实际生成的路径字典。"""
    os.makedirs(outdir, exist_ok=True)
    # 时间戳保持可读；关键词只保留安全字符，便于区分不同搜索结果。
    keyword_part = "".join(
        ch if ch.isalnum() or ch in "-_" else "_"
        for ch in str(keyword or "").strip()
    )[:32] or "keyword"
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    stem = f"boss_jobs_{city_code}_{keyword_part}_{stamp}"
    # 若系统时钟精度不足导致碰撞，则追加序号，绝不覆盖旧结果。
    extensions = ["csv", "json"] if fmt == "both" else [fmt]
    base = stem
    suffix = 1
    while any(os.path.exists(os.path.join(outdir, f"{base}.{ext}")) for ext in extensions):
        base = f"{stem}_{suffix}"
        suffix += 1
    paths = {}
    if fmt in ("csv", "both"):
        p = os.path.join(outdir, f"{base}.csv")
        with open(p, "w", newline="", encoding="utf-8-sig") as f:  # utf-8-sig：Excel 不乱码（踩坑6）
            w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow(r)
        paths["csv"] = p
    if fmt in ("json", "both"):
        p = os.path.join(outdir, f"{base}.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
        paths["json"] = p
    return paths


def run_fetch(keyword, city, pages, fmt, delay, port, progress=None):
    # TUI/旧调用方可能传入文本框字符串；业务入口统一规范化，避免类型错误进入分页循环。
    keyword = str(keyword or "").strip()
    city = str(city or "").strip()
    try:
        pages = int(pages)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"页数必须是整数：{pages!r}") from exc
    if not 1 <= pages <= 10:
        raise ValueError(f"页数必须是 1-10：{pages}")
    try:
        delay = float(delay)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"页间隔必须是数字：{delay!r}") from exc
    if delay < 0:
        raise ValueError(f"页间隔不能为负数：{delay}")
    if not keyword:
        raise ValueError("关键词不能为空")
    if fmt not in ("csv", "json", "both"):
        raise ValueError(f"导出格式不支持：{fmt!r}")
    city_code = city if city.isdigit() else CITY_CODES.get(city, city)
    if not city_code or not str(city_code).isdigit():
        raise ValueError(f"未知城市：{city}，请用 --city-code 传城市码（全量码表见 /wapi/zpCommon/data/cityGroup.json）")
    port = ensure_edge_running(port)
    if callable(progress):
        progress(0, pages, "连接专用浏览器", "正在建立 CDP 会话")
    print(f"[fetch] 开始抓取：{keyword} @ {city}，共 {pages} 页", flush=True)
    session = None
    all_rows, failed = [], []
    try:
        session = _new_session(port)
        session.send("Network.enable")
        session.send("Page.enable")
        for page in range(1, pages + 1):
            try:
                rows = fetch_page(
                    session, keyword, city_code, page, delay,
                    total_pages=pages, progress=progress,
                )
                all_rows.extend(rows)
                if callable(progress):
                    progress(page, pages, f"完成第 {page}/{pages} 页", f"本页 {len(rows)} 条，累计 {len(all_rows)} 条")
                print(f"[fetch] 第 {page} 页 OK，累计 {len(all_rows)} 条", flush=True)
            except Exception as e:
                failed.append(page)
                if callable(progress):
                    progress(page, pages, f"第 {page}/{pages} 页失败", str(e))
                print(f"[fetch] 第 {page} 页失败：{e}", flush=True)
                if delay > 0 and page < pages:
                    time.sleep(delay)  # 失败也给缓冲，不硬闯
    finally:
        if session is not None:
            session.close()
    if all_rows:
        paths = export_rows(all_rows, keyword, city_code, fmt)
        for k, p in paths.items():
            print(f"[export] {k.upper()} -> {p}")
    elif not failed:
        print("[fetch] 接口响应成功，但没有岗位结果（当前搜索条件可能无匹配）", flush=True)
    completed_at = time.strftime("%Y-%m-%d %H:%M:%S")
    if failed:
        print(f"[fetch] 失败页：{failed}，已抓数据已保存，可缩小 --pages 重跑。")
        if all_rows:
            if callable(progress):
                progress(pages, pages, "部分完成", f"成功 {len(all_rows)} 条，失败页 {failed}")
            print(f"⚠ [fetch] 部分完成：{completed_at}，成功 {len(all_rows)} 条，失败页 {failed}", flush=True)
        else:
            raise RuntimeError(f"所有 {len(failed)} 页均抓取失败，未生成有效岗位数据")
    else:
        print(f"🎉 [fetch] 抓取成功：{completed_at}，共 {len(all_rows)} 条，完成 {pages} 页", flush=True)
    return all_rows


# ---------------------------------------------------------------- CLI 入口

def main():
    ap = argparse.ArgumentParser(description="BOSS直聘职位/公司名采集（CDP 方案）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("setup", help="启动专用 Edge 并等待扫码登录")
    s.add_argument("--keyword", default="内贸", help="探测用关键词（默认：内贸）")
    s.add_argument("--city", default="深圳", help="探测用城市（默认：深圳）")
    s.add_argument("--login-timeout", type=int, default=900, help="等待登录秒数（默认 900）")
    s.add_argument("--port", type=int, default=DEFAULT_PORT)

    f = sub.add_parser("fetch", help="抓取职位数据（复用持久登录态）")
    f.add_argument("--keyword", required=True, help="搜索关键词，如：国内电商")
    f.add_argument("--city", required=True, help="城市（中文名或城市码均可）")
    f.add_argument("--pages", type=int, default=1, help="抓取页数（默认 1）")
    f.add_argument("--format", choices=["csv", "json", "both"], default="csv")
    f.add_argument("--delay", type=float, default=3, help="每页间隔秒数（默认 3，低频防封）")
    f.add_argument("--port", type=int, default=DEFAULT_PORT)

    args = ap.parse_args()
    exit_code = 0
    try:
        if args.cmd == "setup":
            active_port = ensure_edge_running(args.port)
            cc = CITY_CODES.get(args.city, args.city)
            if not login_wait(args.keyword, cc, active_port, args.login_timeout):
                exit_code = 2
        elif args.cmd == "fetch":
            run_fetch(args.keyword, args.city, args.pages, args.format, args.delay, args.port)
    except Exception as e:
        print(f"[error] {e}")
        exit_code = 1
    finally:
        # CLI 进程结束时只清理本进程启动的浏览器，不影响端口已有的外部实例。
        close_owned_edge()
    if exit_code:
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
