#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BOSS 采集业务入口：专用 Edge、被动响应监听、人工验证、检查点与明确终态。

不直连网站私有 API，不自动提交验证码，不改变浏览器指纹或轮换身份。
CDP 传输、结果契约、持久化分别位于 boss_transport / boss_types / boss_storage。
CLI、TUI、外部调用共用 run_fetch；返回值兼容 list，并附带真实任务状态。
"""
import argparse
import base64
from html.parser import HTMLParser
import json
import os
import socket
import subprocess
import sys
import time
import traceback
import urllib.parse

import requests
from websocket import create_connection, WebSocketTimeoutException
from boss_transport import CDPSession, JOBLIST_PATH_PART
from boss_pagination import advance_page, request_diagnostics
from boss_types import (FetchResult, FetchError, FetchCancelled, ProtocolError,
                        ResponseSchemaError, SiteResponseError, VerificationRequired,
                        positive_integer, finite_seconds, check_cancelled)
from boss_storage import CSV_FIELDS, CheckpointStore, recover_checkpoint
from boss_storage import export_rows as _export_rows

DEFAULT_PORT = 9222
MAX_PAGES = 1000
PROFILE_DIR = os.path.join(os.path.expanduser("~"), ".boss-zhipin-scraper", "edge-profile")
RESULT_DIR = os.path.join(os.path.expanduser("~"), ".boss-zhipin-scraper", "job-result")
SEARCH_PAGE_URL = "https://www.zhipin.com/web/geek/job"
AUTH_COOKIE_NAMES = frozenset({"wt2", "zp_at"})
COMPANY_DETAIL_INTERVAL = 1.0
COMPANY_DETAIL_TIMEOUT = 15
EDGE_CANDIDATES = [
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
]
CITY_CODES = {
    "北京": "101010100", "上海": "101020100", "天津": "101030100", "重庆": "101040100",
    "广州": "101280100", "深圳": "101280600", "杭州": "101210100", "南京": "101190100",
    "苏州": "101190400", "无锡": "101190200", "宁波": "101210400", "成都": "101270100",
    "武汉": "101200100", "西安": "101110100", "长沙": "101250100", "郑州": "101180100",
    "济南": "101120100", "青岛": "101120200", "福州": "101230100", "厦门": "101230200",
    "东莞": "101281600", "佛山": "101280800", "合肥": "101220100", "大连": "101070200",
}
_owned_edge_processes = {}
_preserved_edge_ports = set()


# ---- 浏览器所有权：只关闭本进程实际启动且未交给用户验证的实例 ----
def find_edge():
    for path in EDGE_CANDIDATES:
        if os.path.exists(path):
            return path
    raise FileNotFoundError("未找到 Microsoft Edge，请确认系统 Edge 已安装")


def cdp_ready(port, timeout=2):
    try:
        response = requests.get(f"http://127.0.0.1:{port}/json/version", timeout=max(0.1, float(timeout)))
        if response.status_code != 200:
            return False
        data = response.json()
        url = urllib.parse.urlsplit(data.get("webSocketDebuggerUrl", ""))
        return (url.scheme == "ws" and url.hostname in ("127.0.0.1", "localhost", "::1")
                and url.port == int(port) and bool(data.get("Browser")))
    except (requests.RequestException, ValueError, TypeError, AttributeError):
        return False


def find_free_port(preferred=DEFAULT_PORT):
    preferred = int(preferred)
    if preferred <= 0:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])
    for candidate in range(preferred, min(preferred + 100, 65536)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", candidate))
            except OSError:
                continue
            return candidate
    raise OSError(f"从端口 {preferred} 开始没有找到可用端口")


def ensure_edge_running(port=DEFAULT_PORT, start_url="about:blank"):
    requested_port = positive_integer(port, "调试端口", 65535)
    for owned_port in tuple(_owned_edge_processes):
        if cdp_ready(owned_port):
            return owned_port
    for saved_port in tuple(_preserved_edge_ports):
        if cdp_ready(saved_port):
            return saved_port
        _preserved_edge_ports.discard(saved_port)
    if cdp_ready(requested_port):
        return requested_port
    os.makedirs(PROFILE_DIR, exist_ok=True)
    browser_path = find_edge()
    active_port = find_free_port(requested_port)
    if active_port != requested_port:
        print(f"[browser] 端口 {requested_port} 已被占用，改用 {active_port}", flush=True)
    command = [browser_path, f"--remote-debugging-port={active_port}",
               "--remote-debugging-address=127.0.0.1", f"--user-data-dir={PROFILE_DIR}",
               f"--remote-allow-origins=http://127.0.0.1:{active_port},http://localhost:{active_port}",
               "--no-first-run", "--no-default-browser-check", "--new-window", start_url]
    print("[browser] 启动专用 Microsoft Edge…", flush=True)
    try:
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Microsoft Edge 启动失败：{exc}") from exc
    _owned_edge_processes[active_port] = process
    for _ in range(60):
        if cdp_ready(active_port):
            return active_port
        if process.poll() is not None:
            break
        time.sleep(0.5)
    close_owned_edge(active_port)
    raise TimeoutError("Edge 调试端口未就绪；请检查专用 Profile 是否已被另一个实例占用")


def _close_browser_via_cdp(port):
    ws = None
    try:
        response = requests.get(f"http://127.0.0.1:{port}/json/version", timeout=1)
        response.raise_for_status()
        ws = create_connection(response.json()["webSocketDebuggerUrl"], timeout=1)
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
    deadline = time.monotonic() + max(0.1, timeout)
    while time.monotonic() < deadline:
        if not cdp_ready(port, timeout=min(0.5, max(0.1, deadline - time.monotonic()))):
            return True
        time.sleep(0.1)
    return not cdp_ready(port, timeout=0.5)


def _terminate_process_tree(pid):
    if os.name == "nt":
        try:
            result = subprocess.run(["taskkill.exe", "/PID", str(pid), "/T", "/F"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    timeout=3, check=False)
            return result.returncode == 0
        except (OSError, subprocess.SubprocessError, ValueError):
            return False
    try:
        os.kill(pid, 15)
    except (ProcessLookupError, PermissionError):
        pass
    return True


def _close_owned_edge_port(port):
    process = _owned_edge_processes.pop(port, None)
    if process is None:
        return False
    try:
        if _close_browser_via_cdp(port) and _wait_for_cdp_closed(port):
            return True
        _terminate_process_tree(int(process.pid))
        _wait_for_cdp_closed(port, timeout=1)
    except Exception as exc:
        print(f"[browser] 清理失败：{type(exc).__name__}: {exc}", file=sys.stderr)
    return True


def close_owned_edge(port=None):
    if port is not None:
        return _close_owned_edge_port(int(port))
    closed = False
    for active_port in tuple(_owned_edge_processes):
        closed = _close_owned_edge_port(active_port) or closed
    return closed


def preserve_owned_edge(port):
    # 移交给用户后，CLI/TUI 的 finally 不得再关闭验证页面。
    _owned_edge_processes.pop(port, None)
    _preserved_edge_ports.add(port)
    print("[browser] 已保留专用浏览器，请在原页面处理登录/验证；处理后再发起采集。", flush=True)


def open_tab(port=DEFAULT_PORT, url="about:blank"):
    address = f"http://127.0.0.1:{port}/json/new?{urllib.parse.quote(url, safe='')}"
    for method in (requests.put, requests.get):
        try:
            response = method(address, timeout=5)
            if 200 <= response.status_code < 300:
                info = response.json()
                tab = next(item for item in info if item.get("type") == "page") if isinstance(info, list) else info
                ws_url = tab["webSocketDebuggerUrl"]
                parsed = urllib.parse.urlsplit(ws_url)
                if (parsed.scheme != "ws" or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
                        or parsed.port != int(port)):
                    raise ProtocolError("CDP 标签页返回了非本机调试地址")
                return ws_url
        except (requests.RequestException, ValueError, KeyError, StopIteration):
            continue
    raise RuntimeError("无法创建 CDP 标签页")


def _new_session(port):
    # 先空白页、再启用监听，最后只导航一次搜索页；不在监听前发出网站请求。
    return CDPSession(open_tab(port, url="about:blank"))


def search_url(keyword, city_code, page):
    return SEARCH_PAGE_URL + "?" + urllib.parse.urlencode({"query": keyword, "city": city_code, "page": page})


def normalize_page_count(value):
    return positive_integer(value, "页数", MAX_PAGES)


def normalize_city(city):
    value = str(city or "").strip()
    if value.endswith("市") and value[:-1] in CITY_CODES:
        value = value[:-1]
    if value in CITY_CODES or (len(value) == 9 and value.isascii() and value.isdigit()):
        return value
    raise ValueError("未知城市：" + (value or "空") + "；请填写支持的城市名或9位城市码（命令行使用 --city）")


# ---- 响应解析：结构错误与真正的空列表严格区分 ----
def response_job_list(data):
    if not isinstance(data, dict):
        raise ResponseSchemaError("joblist 响应必须是对象")
    nested = data.get("zpData")
    if isinstance(nested, dict) and "jobList" in nested:
        items = nested["jobList"]
    elif "zpList" in data:
        items = data["zpList"]
    elif "jobList" in data:
        items = data["jobList"]
    else:
        raise ResponseSchemaError("joblist 缺少岗位列表字段；不能将接口变化当作零条结果")
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise ResponseSchemaError("岗位列表结构不合法")
    return items


def _get_body(session, request_id, timeout=20):
    # Edge 偶尔在 loadingFinished 后短暂返回 -32000；同一 requestId
    # 仍有效时重取正文，避免把瞬时 CDP 竞态误报为采集失败。
    last_error = None
    for attempt in range(3):
        mid = session.send("Network.getResponseBody", {"requestId": request_id})
        response = session.wait_response(mid, timeout=timeout)
        if response is None:
            raise TimeoutError("读取响应正文超时")
        if "error" in response:
            message = str(response["error"].get("message", "未知错误"))
            last_error = message
            if "No resource with given identifier found" in message and attempt < 2:
                time.sleep(0.1)
                continue
            raise ProtocolError("响应正文不可读：" + message)
        result = response.get("result", {})
        body = result.get("body", "")
        encoded = result.get("base64Encoded", False)
        if encoded:
            body = base64.b64decode(body, validate=True).decode("utf-8")
        return body, encoded
    raise ProtocolError("响应正文不可读：" + (last_error or "未知错误"))


def _joblist_response_data(session, params):
    request_id = params.get("requestId")
    expected = session.expected_joblist
    actual = session.joblist_requests.pop(request_id, {})
    if not request_id or (expected and any(actual.get(key, [None])[0] != str(value)
                                           for key, value in expected.items())):
        return None
    if params.get("_failure"):
        raise ConnectionError("joblist 网络加载失败：" + params["_failure"])
    status = params.get("response", {}).get("status")
    if status in (401, 403, 429):
        raise VerificationRequired(f"HTTP {status}", "访问受限，请在浏览器中处理", page=expected.get("page") if expected else None)
    if isinstance(status, (int, float)) and status >= 400:
        raise SiteResponseError(f"HTTP {status}", "网站返回错误")
    body, _ = _get_body(session, request_id, timeout=5)
    try:
        data = json.loads(body)
    except (ValueError, TypeError) as exc:
        raise ResponseSchemaError("joblist 正文不是有效 JSON；可能是验证页或接口已变化") from exc
    if not isinstance(data, dict) or type(data.get("code")) is not int:
        raise ResponseSchemaError("joblist 缺少有效的整数 code")
    return data


def _await_joblist(session, timeout=60, progress_message="", progress=None,
                   progress_current=0, progress_total=0, progress_stage="等待网络响应",
                   progress_started_at=None, on_tick=None, stop_event=None):
    started = time.monotonic()
    deadline = started + max(0, timeout)
    last_report = started - 10
    while time.monotonic() < deadline:
        check_cancelled(stop_event)
        params = session.pop_joblist()
        if params is not None:
            data = _joblist_response_data(session, params)
            if data is not None:
                return data
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        # recv_event 统一记录事件；仅 loadingFinished 后的响应进入 pop_joblist。
        session.recv_event(timeout=min(0.5, remaining))
        if callable(on_tick):
            on_tick()
        now = time.monotonic()
        if now - last_report >= 1:
            elapsed = int(now - started)
            if callable(progress):
                progress(progress_current, progress_total, progress_stage, f"已等待 {elapsed}s")
            if progress_message and (int(now - started) % 10 == 0):
                print(f"{progress_message}（已等待 {elapsed}s）", flush=True)
            last_report = now
    return None


def _browser_has_auth_cookie(session, timeout=2):
    # 兼容外部调用；仅凭 cookie 不能宣称已登录。
    mid = session.send("Network.getCookies", {"urls": ["https://www.zhipin.com/"]})
    response = session.wait_response(mid, timeout=timeout)
    if not response or "error" in response:
        return False
    return any(cookie.get("name") in AUTH_COOKIE_NAMES and bool(cookie.get("value"))
               for cookie in response.get("result", {}).get("cookies", []))


def login_wait(keyword, city_code, port=DEFAULT_PORT, login_timeout=900, progress=None, stop_event=None):
    timeout = positive_integer(login_timeout, "登录等待时间", 3600)
    session = _new_session(port)
    session.stop_event = stop_event
    success = False
    try:
        session.command("Network.enable")
        session.command("Page.enable")
        session.expected_joblist = {"page": 1, "query": keyword, "city": city_code}
        session.command("Page.navigate", {"url": search_url(keyword, city_code, 1)})
        print("[login] 请在原 Edge 页面完成登录/验证，并手动搜索原关键词；程序不刷新验证页。", flush=True)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            data = _await_joblist(session, timeout=max(0, deadline - time.monotonic()),
                                  progress=progress, progress_stage="等待用户登录/验证", stop_event=stop_event)
            if data is None:
                break
            if data["code"] == 0:
                count = len(response_job_list(data))
                print(f"[login] 登录接口验证通过：{count} 条岗位。登录态可能过期，以后仍以接口为准。", flush=True)
                success = True
                return True
            print(f"[login] 网站返回 code:{data['code']}；请在浏览器处理后手动搜索。", flush=True)
        print("[login] 等待超时，未确认登录成功。", flush=True)
        return False
    except FetchCancelled:
        return False
    finally:
        if not success:
            session.keep_open = True
            preserve_owned_edge(port)
        session.close()


# ---- 公司信息解析 ----
class _CompanyNameParser(HTMLParser):
    _VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._depth = 0
        self._parts = []

    def handle_starttag(self, tag, attrs):
        if self._depth:
            if tag.lower() not in self._VOID_TAGS:
                self._depth += 1
        elif tag.lower() == "li" and "company-name" in dict(attrs).get("class", "").split():
            self._depth = 1

    def handle_endtag(self, tag):
        if self._depth and tag.lower() not in self._VOID_TAGS:
            self._depth -= 1

    def handle_data(self, data):
        if self._depth:
            self._parts.append(data)

    def company_name(self):
        text = " ".join("".join(self._parts).split())
        return text[len("公司名称"):].lstrip(" ：:").strip() if text.startswith("公司名称") else ""


def company_name_from_detail_html(document):
    if not document:
        return ""
    parser = _CompanyNameParser()
    parser.feed(str(document))
    parser.close()
    return parser.company_name()


def job_detail_url(item, include_session_context=False):
    job_id = item.get("encryptJobId") or item.get("jobId")
    if not job_id:
        return ""
    url = "https://www.zhipin.com/job_detail/" + urllib.parse.quote(str(job_id), safe="") + ".html"
    if include_session_context:
        params = [(key, item[key]) for key in ("lid", "securityId") if item.get(key)]
        if params:
            url += "?" + urllib.parse.urlencode(params)
    return url


def parse_job(item, company_name=None):
    if not isinstance(item, dict):
        raise ValueError("岗位数据必须是对象")
    def join(value):
        if isinstance(value, (list, tuple)):
            return ",".join(str(x) for x in value if x not in (None, ""))
        return "" if value in (None, "") else str(value)
    def get(*keys):
        for key in keys:
            if item.get(key) not in (None, ""):
                return join(item[key])
        return ""
    return {"company": join(company_name) if company_name not in (None, "") else get("companyName"),
            "brand": get("brandName", "brandNameAlias"), "title": get("jobName", "jobTitle"),
            "salary": get("salaryDesc"),
            "location": "·".join(join(item[key]) for key in ("cityName", "areaDistrict", "businessDistrict") if item.get(key) not in (None, "")),
            "tags": join(item.get("jobLabels")), "skills": join(item.get("skills")),
            "boss_name": get("bossName"), "boss_title": get("bossTitle"),
            "job_link": job_detail_url(item), "job_id": get("jobId", "encryptJobId")}


def deduplicate_job_items(items, seen_job_ids=None):
    seen = seen_job_ids if seen_job_ids is not None else set()
    unique, duplicates = [], 0
    for item in items:
        if not isinstance(item, dict):
            raise ResponseSchemaError("岗位记录不是对象")
        job_id = item.get("jobId") or item.get("encryptJobId")
        key = str(job_id).strip() if job_id not in (None, "") else ""
        if key and key in seen:
            duplicates += 1
            continue
        if key:
            seen.add(key)
        unique.append(item)
    return unique, duplicates


def filter_job_items(items, title_filter=""):
    terms = [term.strip().casefold() for term in str(title_filter or "").replace("，", ",").split(",") if term.strip()]
    return [item for item in items if not terms or any(term in str(item.get("jobName") or item.get("jobTitle") or "").casefold() for term in terms)]


def _load_detail_html(session, url, timeout=COMPANY_DETAIL_TIMEOUT):
    expected_path = urllib.parse.urlsplit(url).path
    navigation = session.command("Page.navigate", {"url": url}, timeout=min(5, timeout))
    expected_frame = navigation.get("frameId")
    request_id = None
    deadline = time.monotonic() + max(0, timeout)
    while time.monotonic() < deadline:
        event = session.recv_event(timeout=min(0.5, max(0.01, deadline - time.monotonic())))
        if event is None:
            continue
        params = event.get("params", {})
        method = event.get("method")
        if method == "Network.responseReceived" and params.get("type") == "Document":
            if expected_frame and params.get("frameId") != expected_frame:
                continue
            response = params.get("response", {})
            path = urllib.parse.urlsplit(response.get("url", "")).path
            if response.get("status") in (401, 403, 429) or any(part in path for part in ("/passport/", "/security", "/web/user/")):
                session.keep_open = True
                status = response.get("status", "详情验证")
                parsed_location = urllib.parse.urlsplit(response.get("url") or path)
                location = urllib.parse.urlunsplit((parsed_location.scheme, parsed_location.hostname or "",
                                                     parsed_location.path, "", ""))
                raise VerificationRequired(status, f"岗位详情页要求登录或安全验证；响应地址：{location}")
            if path == expected_path:
                if response.get("status", 200) >= 400:
                    raise SiteResponseError(response["status"], "岗位详情页加载失败")
                request_id = params.get("requestId")
        elif request_id and params.get("requestId") == request_id:
            if method == "Network.loadingFailed":
                raise ConnectionError("岗位详情页加载失败：" + params.get("errorText", "未知错误"))
            if method == "Network.loadingFinished":
                body, _ = _get_body(session, request_id, timeout=min(5, max(0.01, deadline - time.monotonic())))
                return body
    raise TimeoutError("岗位详情页主文档读取超时")


def fetch_company_full_name(session, item, timeout=COMPANY_DETAIL_TIMEOUT):
    url = job_detail_url(item, include_session_context=True)
    if not url:
        raise ValueError("岗位缺少详情 ID")
    company = company_name_from_detail_html(_load_detail_html(session, url, timeout))
    if not company:
        raise ValueError("岗位详情页未披露公司名称")
    return company


def enrich_company_names(session, items, company_cache=None, page=1, total_pages=0, progress=None, stop_event=None):
    # 列表已收到就先保留全部岗位；详情中断不能把当页剩余岗位也丢掉。
    rows = [parse_job(item) for item in items]
    cache = company_cache if company_cache is not None else {}
    request_count = 0
    consecutive_failures = 0
    try:
        for index, (item, row) in enumerate(zip(items, rows), 1):
            check_cancelled(stop_event)
            if row["company"]:
                continue
            # 同一品牌可能包含多家法人主体，不能用品牌简称/品牌 ID 推断企业全称。
            cache_key = job_detail_url(item)
            if cache_key and cache.get(cache_key):
                row["company"] = cache[cache_key]
                continue
            if request_count:
                if stop_event is not None:
                    stop_event.wait(COMPANY_DETAIL_INTERVAL)
                else:
                    time.sleep(COMPANY_DETAIL_INTERVAL)
                check_cancelled(stop_event)
            if callable(progress):
                progress(page - 1, total_pages, f"第 {page} 页：补全公司全称", f"正在处理 {index}/{len(items)}")
            request_count += 1
            try:
                row["company"] = fetch_company_full_name(session, item)
                consecutive_failures = 0
            except VerificationRequired:
                session.keep_open = True
                raise
            except FetchCancelled:
                raise
            except Exception as exc:
                consecutive_failures += 1
                print(f"[company] 第 {page} 页第 {index} 条未取得企业全称：{type(exc).__name__}: {exc}", flush=True)
                if consecutive_failures >= 3:
                    raise FetchError("企业详情连续3次失败，已停止后续请求；岗位列表和已补全信息会保存") from exc
            if cache_key and row["company"]:
                cache[cache_key] = row["company"]
    except (Exception, KeyboardInterrupt, SystemExit) as exc:
        exc.rows = rows
        raise
    return rows


def _search_response(session, page, total_pages, progress, stop_event, verification_timeout):
    deadline = time.monotonic() + 60
    blocked = None
    while True:
        check_cancelled(stop_event)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            if blocked is not None:
                raise blocked
            raise TimeoutError(f"第 {page} 页未捕获到匹配的 joblist 完整响应；{request_diagnostics(session)}")
        try:
            data = _await_joblist(session, timeout=remaining, progress=progress,
                                  progress_current=page - 1, progress_total=total_pages,
                                  progress_stage="等待用户验证（不刷新）" if blocked else f"等待第 {page} 页响应",
                                  stop_event=stop_event)
        except VerificationRequired as exc:
            error = exc
        else:
            if data is None:
                if blocked is not None:
                    raise blocked
                raise TimeoutError(f"第 {page} 页未捕获到匹配的 joblist 完整响应；{request_diagnostics(session)}")
            if data["code"] == 0:
                response_job_list(data)  # 校验通过才恢复，不把 HTML/未知结构当作成功。
                session.keep_open = False
                return data
            if data["code"] != 37:
                raise SiteResponseError(data["code"], str(data.get("message", "")), page=page)
            error = VerificationRequired(37, str(data.get("message", "您的环境存在异常")), page=page)
        session.keep_open = True
        if blocked is None:
            blocked = error
            print(f"[verify] {error}；已停止自动请求。请在原 Edge 页面完成登录/验证。", flush=True)
            if verification_timeout <= 0:
                raise blocked
            deadline = time.monotonic() + verification_timeout
            print(f"[verify] 最多等待 {verification_timeout:g} 秒，仅监听用户操作后的原搜索响应，不自动刷新。", flush=True)
        # 用户多次操作仍失败时不重置计时器，也不主动重试网站请求。


def fetch_page(session, keyword, city_code, page, page_delay=3, total_pages=0, progress=None,
               seen_job_ids=None, company_cache=None, detail_session=None, page_info=None,
               title_filter="", stop_event=None, verification_timeout=0):
    check_cancelled(stop_event)
    if page == 1:
        session.reset_joblist()
    session.expected_joblist = {"page": page, "query": keyword, "city": city_code}
    print(f"[fetch] 第 {page} 页：等待与配置一致的接口响应…", flush=True)
    if page == 1:
        session.command("Page.navigate", {"url": search_url(keyword, city_code, 1)})
    else:
        # 由真实页面滚动触发翻页，不伪造网址页码或直接调用网站接口。
        advance_page(session)
    data = _search_response(session, page, total_pages, progress, stop_event, verification_timeout)
    raw_items = response_job_list(data)
    items, duplicates = deduplicate_job_items(raw_items, seen_job_ids)
    nested = data.get("zpData") if isinstance(data.get("zpData"), dict) else {}
    has_more = nested.get("hasMore")
    if has_more is not None and type(has_more) is not bool:
        error = ResponseSchemaError("hasMore 不是布尔值，无法可靠判定是否还有下一页")
        error.rows = [parse_job(item) for item in filter_job_items(items, title_filter)]
        raise error
    if page_info is not None:
        page_info.update(raw_count=len(raw_items), new_count=len(items), has_more=has_more)
    print(f"[page] 已确认第 {page} 页：返回 {len(raw_items)} 条，新增 {len(items)} 条，重复 {duplicates} 条", flush=True)
    items = filter_job_items(items, title_filter)
    return enrich_company_names(detail_session or session, items, company_cache=company_cache,
                                page=page, total_pages=total_pages, progress=progress, stop_event=stop_event)


def export_rows(rows, keyword, city_code, fmt, outdir=None):
    # 不在默认参数中冻结 RESULT_DIR，便于测试和调用方正确指定输出位置。
    return _export_rows(rows, keyword, city_code, fmt, RESULT_DIR if outdir is None else outdir)


def run_fetch(keyword, city, pages, fmt, delay, port, progress=None, title_filter="", stop_event=None,
              verification_timeout=0, outdir=None):
    keyword = str(keyword or "").strip()
    if not keyword:
        raise ValueError("关键词不能为空")
    city = normalize_city(city)
    pages = normalize_page_count(pages)
    delay = finite_seconds(delay, "页间隔")
    verification_timeout = finite_seconds(verification_timeout, "验证等待时间")
    port = positive_integer(port, "调试端口", 65535)
    if fmt not in ("csv", "json", "both"):
        raise ValueError(f"导出格式不支持：{fmt!r}")
    city_code = CITY_CODES.get(city, city)
    folder = RESULT_DIR if outdir is None else os.fspath(outdir)
    result = FetchResult(requested_pages=pages)
    if stop_event is not None and stop_event.is_set():
        result.status = "cancelled"
        return result
    session = detail_session = store = None
    failure = None
    saving_page = False
    page = 0
    try:
        store = CheckpointStore(folder, keyword, city_code, pages)
        result.checkpoint = store.path
        print(f"[checkpoint] {store.path}", flush=True)
        port = ensure_edge_running(port)
        session = _new_session(port)
        session.stop_event = stop_event
        session.command("Network.enable")
        session.command("Page.enable")
        detail_session = _new_session(port)
        detail_session.stop_event = stop_event
        detail_session.command("Network.enable")
        detail_session.command("Page.enable")
        seen, cache = set(), {}
        for page in range(1, pages + 1):
            check_cancelled(stop_event)
            page_info = {}
            rows = fetch_page(session, keyword, city_code, page, delay,
                              total_pages=pages, progress=progress, seen_job_ids=seen,
                              company_cache=cache, detail_session=detail_session, page_info=page_info,
                              title_filter=title_filter, stop_event=stop_event,
                              verification_timeout=verification_timeout)
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ResponseSchemaError("单页采集未返回有效岗位列表")
            result.extend(rows)
            saving_page = True
            store.write_page(page, rows)
            saving_page = False
            result.completed_pages = page
            if callable(progress):
                progress(page, pages, f"完成第 {page}/{pages} 页", f"累计 {len(result)} 条，已写检查点")
            check_cancelled(stop_event)
            if page_info.get("has_more") is False or page_info.get("raw_count") == 0:
                break
            if page_info.get("new_count") == 0:
                result.status = "partial"
                result.reason = "页面没有新增岗位，已停止重复加载；不能确认已采全"
                break
            if page < pages and delay:
                if stop_event is not None:
                    stop_event.wait(delay)
                else:
                    time.sleep(delay)
    except (Exception, KeyboardInterrupt, SystemExit) as exc:
        failure = exc
        partial_rows = getattr(exc, "rows", [])
        if partial_rows:
            result.extend(partial_rows)
            if store is not None:
                try:
                    store.write_page(page, partial_rows)
                except OSError as save_error:
                    print(f"[checkpoint] 保存本页失败：{save_error}", file=sys.stderr)
                    failure = save_error
                    saving_page = True
        if saving_page:
            result.status = "failed"
        elif isinstance(failure, (FetchCancelled, KeyboardInterrupt)):
            result.status = "cancelled"
        elif isinstance(failure, VerificationRequired):
            result.status = "blocked"
        else:
            result.status = "partial" if result and not isinstance(failure, SystemExit) else "failed"
        result.reason = f"{type(failure).__name__}: {failure}"
        if page and result.status != "cancelled":
            result.failed_pages.append(page)
        print(f"[fetch] {result.reason}", flush=True)
        if not isinstance(exc, (FetchCancelled, KeyboardInterrupt)):
            traceback.print_exc(file=sys.stderr)
    finally:
        sessions = [value for value in (session, detail_session) if value is not None]
        if any(value.keep_open for value in sessions):
            preserve_owned_edge(port)
        for value in sessions:
            try:
                value.close()
            except Exception as exc:
                print(f"[browser] 标签页清理失败：{type(exc).__name__}: {exc}", file=sys.stderr)

    try:
        if result:
            try:
                result.paths = export_rows(result, keyword, city_code, fmt, outdir=folder)
                for kind, path in result.paths.items():
                    print(f"[export] {kind.upper()} -> {path}", flush=True)
            except (Exception, KeyboardInterrupt) as exc:
                failure = exc
                result.paths = getattr(exc, "paths", {})
                result.status = "failed"
                result.reason = f"结果导出失败：{type(exc).__name__}: {exc}；原始数据检查点：{result.checkpoint}"
        result.missing_company_count = sum(not row.get("company") for row in result)
        if failure is None and result.status != "partial":
            if result.missing_company_count:
                result.status = "partial"
                result.reason = f"{result.missing_company_count} 条岗位缺少企业全称"
            else:
                result.status = "completed" if result else "empty"
        if store is not None:
            try:
                store.finish(result)
            except OSError as exc:
                failure = exc
                result.status = "failed"
                result.reason = f"状态清单保存失败：{exc}；已保存数据：{result.checkpoint}"
                print(f"[checkpoint] 状态清单保存失败，已落盘页面仍保留：{exc}", file=sys.stderr)
        stage = {"completed": "已完成", "empty": "无匹配结果", "partial": "部分完成",
                 "blocked": "需要用户验证", "cancelled": "已停止", "failed": "失败"}[result.status]
        print(f"[fetch] {time.strftime('%Y-%m-%d %H:%M:%S')} {stage}：{len(result)} 条，完成 {result.completed_pages}/{pages} 页；{result.reason}", flush=True)
        if callable(progress):
            progress(result.completed_pages, pages, stage, result.reason or f"共 {len(result)} 条")
    finally:
        if store is not None:
            store.close()
    if failure is not None and result.status == "failed":
        raise FetchError(result.reason, result=result) from failure
    if failure is not None and not result and result.status not in ("cancelled",):
        if isinstance(failure, FetchError):
            failure.result = result
            raise failure
        raise FetchError(result.reason, result=result) from failure
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="BOSS职位/企业采集（人工验证、真实状态、逐页保存）")
    sub = parser.add_subparsers(dest="cmd", required=True)
    setup = sub.add_parser("setup", help="在专用 Edge 中正常登录并验证接口")
    setup.add_argument("--keyword", default="国内电商")
    setup.add_argument("--city", default="深圳")
    setup.add_argument("--login-timeout", type=int, default=900)
    setup.add_argument("--port", type=int, default=DEFAULT_PORT)
    fetch = sub.add_parser("fetch")
    fetch.add_argument("--keyword", required=True)
    fetch.add_argument("--city", required=True)
    fetch.add_argument("--pages", type=int, default=1)
    fetch.add_argument("--format", choices=["csv", "json", "both"], default="csv")
    fetch.add_argument("--delay", type=float, default=3)
    fetch.add_argument("--port", type=int, default=DEFAULT_PORT)
    fetch.add_argument("--title-filter", default="")
    fetch.add_argument("--verification-timeout", type=float, default=0,
                       help="遇验证时仅监听人工操作的等待秒数，默认0立即报错并保留页面")
    recover = sub.add_parser("recover", help="从已保存检查点导出，不访问网站、不自动续爬")
    recover.add_argument("path")
    recover.add_argument("--format", choices=["csv", "json", "both"], default="csv")
    args = parser.parse_args(argv)
    try:
        if args.cmd == "setup":
            city = normalize_city(args.city)
            port = ensure_edge_running(args.port)
            return 0 if login_wait(args.keyword, CITY_CODES.get(city, city), port, args.login_timeout) else 2
        if args.cmd == "recover":
            rows, header = recover_checkpoint(args.path)
            city = normalize_city(header.get("city", ""))
            paths = export_rows(rows, header.get("keyword", "recovered"), CITY_CODES.get(city, city), args.format)
            print(f"[recover] 从检查点恢复 {len(rows)} 条：{paths}")
            return 0
        result = run_fetch(args.keyword, args.city, args.pages, args.format, args.delay, args.port,
                           title_filter=args.title_filter, verification_timeout=args.verification_timeout)
        return result.exit_code
    except VerificationRequired as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 3
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print(f"[error] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        close_owned_edge()


if __name__ == "__main__":
    raise SystemExit(main())
