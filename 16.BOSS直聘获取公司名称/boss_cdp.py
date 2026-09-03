#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
boss_cdp.py —— BOSS直聘职位/公司名自动采集（CDP 浏览器方案，可复用工具）

依据仓库 issue #636「BOSS直聘职位数据自动采集」完整经验实现：
  - 不抓 DOM，不用 Selenium/Playwright（受控浏览器指纹明显，极易验证码）
  - 独立 Chrome 实例（独立 user-data-dir + CDP 调试端口 + --remote-allow-origins=*）
  - 人工扫码登录一次，登录态永久保存在该 profile，后续不再登录
  - CDP 监听页面自身发出的 /wapi/zpgeek/search/joblist.json 响应，解析明文 JSON（绕开字体反爬）
  - 低频抓取（默认每页间隔 3 秒），增量保存，异常不丢已抓数据

用法：
  python boss_cdp.py setup          # 启动专用 Chrome 并等待登录（仅首次需要扫码）
  python boss_cdp.py fetch --keyword "国内电商" --city 深圳 --pages 2 --format csv

依赖：requests、websocket-client（见 requirements.txt）
由 CLI 与外部调用共享同一业务真源（被 import 时提供 BossCdp 类）。
"""

import argparse
import csv
import json
import os
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

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
]

DEFAULT_PORT = 9222
# 独立 profile = 持久登录态（踩坑2：必须独立 user-data-dir，默认 profile 无法开调试端口）
PROFILE_DIR = os.path.join(os.path.expanduser("~"), ".boss-zhipin-scraper", "chrome-profile")
RESULT_DIR = os.path.join(os.path.expanduser("~"), ".boss-zhipin-scraper", "job-result")

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


def find_chrome():
    for p in CHROME_CANDIDATES:
        if os.path.exists(p):
            return p
    raise FileNotFoundError("未找到 Chrome，请修改 CHROME_CANDIDATES 指定 chrome.exe 路径")


def cdp_ready(port):
    try:
        r = requests.get(f"http://127.0.0.1:{port}/json/version", timeout=2)
        return r.status_code == 200
    except Exception:
        return False


def ensure_chrome_running(port=DEFAULT_PORT):
    """启动独立 Chrome（若端口已监听则直接复用，登录态已在 profile 里）。"""
    if cdp_ready(port):
        return False  # 已运行，复用
    os.makedirs(PROFILE_DIR, exist_ok=True)
    os.makedirs(RESULT_DIR, exist_ok=True)
    cmd = [
        find_chrome(),
        f"--remote-debugging-port={port}",
        f"--user-data-dir={PROFILE_DIR}",
        "--remote-allow-origins=*",   # 踩坑2：不加则 CDP 握手被拒
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
    ]
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):  # 最多等 30 秒
        if cdp_ready(port):
            return True
        time.sleep(0.5)
    raise TimeoutError("Chrome 调试端口未就绪，请检查启动参数")


def open_tab(port=DEFAULT_PORT):
    """新建一个标签页并返回其 webSocketDebuggerUrl。Chrome 127+ 需 PUT。"""
    for method in (requests.put, requests.get):
        try:
            r = method(f"http://127.0.0.1:{port}/json/new?{urllib.parse.urlencode({'url': 'about:blank'})}", timeout=5)
            if r.status_code == 200:
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

    def wait_response(self, mid, timeout=30):
        """等待指定 id 的 response（期间消费事件）。返回响应 dict 或 None。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                msg = json.loads(self.ws.recv())
            except WebSocketTimeoutException:
                return None
            if "id" in msg and msg["id"] == mid:
                return msg
            self._handle_event(msg)
        return None

    def recv_event(self, timeout=30):
        """阻塞收一条事件消息；返回事件 dict 或 None（超时）。"""
        try:
            msg = json.loads(self.ws.recv())
            if "id" in msg:
                self._pending[msg["id"]] = msg
                return None
            return msg
        except WebSocketTimeoutException:
            return None

    def close(self):
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


# ---------------------------------------------------------------- login_wait（模块2）

def login_wait(keyword, city_code, port=DEFAULT_PORT, login_timeout=900):
    """导航搜索页，等 joblist 返回可用数据即视为已登录；否则提示扫码。"""
    session = _new_session(port)
    session.send("Network.enable")
    session.send("Page.enable")
    url = search_url(keyword, city_code, 1)
    deadline = time.time() + login_timeout
    print("[login] 请在弹出的 Chrome 窗口中完成扫码/验证码登录（若已登录可忽略）…")
    while time.time() < deadline:
        _joblist_responses.clear()
        session.send("Page.navigate", {"url": url})
        data = _await_joblist(session, timeout=30)
        if data is not None:
            code = data.get("code")
            if code == 0 and data.get("zpList"):
                print("[login] 登录成功（已抓到岗位数据），登录态已持久化到专用 profile。")
                session.close()
                return True
            if code == 37:
                print("[login] code:37 环境异常——请确认走的是已登录专用 Chrome，勿直连 API。")
        # 未登录：页面通常停留在登录页，继续刷新等待
    session.close()
    print(f"[login] 超时（{login_timeout}s）。请检查窗口内确认登录状态后重试。")
    return False


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


def _await_joblist(session, timeout=60):
    """等待 jblist 响应并取回 body 解析。超时返回 None。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        msg = session.recv_event(timeout=max(1, int(deadline - time.time())))
        if msg is None:
            continue
        method = msg.get("method")
        params = msg.get("params", {})
        if method == "Network.responseReceived":
            resp = params.get("response", {})
            if JOBLIST_PATH_PART in resp.get("url", ""):
                req_id = params["requestId"]
                body, enc = _get_body(session, req_id)
                if body:
                    return json.loads(body)
    return None


def _get_body(session, request_id):
    mid = session.send("Network.getResponseBody", {"requestId": request_id})
    resp = session.wait_response(mid, timeout=20)
    if resp and "error" not in resp:
        r = resp["result"]
        body = r.get("body", "")
        if r.get("base64Encoded"):
            import base64
            body = base64.b64decode(body).decode("utf-8", "replace")
        return body, r.get("base64Encoded", False)
    return None, False


def parse_job(item):
    """把 zpList 单条转成统一 job dict（公司名/岗位/薪资/地区/链接）。"""
    def _g(*keys):
        for k in keys:
            v = item.get(k)
            if v not in (None, ""):
                return v
        return ""

    location = "·".join(x for x in (item.get("cityName"), item.get("areaDistrict"),
                                    item.get("businessDistrict")) if x)
    ejid = item.get("encryptJobId") or item.get("jobId")
    tags = ",".join(item.get("jobLabels") or [])
    skills = ",".join(item.get("skills") or [])
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


def fetch_page(session, keyword, city_code, page, page_delay=3):
    """导航到第 page 页并解析 joblist 数据。返回 row 列表。"""
    _joblist_responses.clear()
    session.send("Page.navigate", {"url": search_url(keyword, city_code, page)})
    data = _await_joblist(session, timeout=60)
    if data is None:
        raise TimeoutError(f"第 {page} 页无 joblist 响应（可能未登录或风控）")
    if data.get("code") != 0:
        raise RuntimeError(f"第 {page} 页返回 code:{data.get('code')} {data.get('message', '')}")
    rows = [parse_job(x) for x in data.get("zpList") or []]
    if page_delay > 0:
        time.sleep(page_delay)  # 低频，避免封号
    return rows


# ---------------------------------------------------------------- export（模块4）

def export_rows(rows, keyword, city_code, fmt, outdir=RESULT_DIR):
    """增量保存：CSV 追加 / JSON 全量列表。返回 (csv_path, json_path) 或 None。"""
    os.makedirs(outdir, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    base = f"boss_jobs_{city_code}_{stamp}"
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


def run_fetch(keyword, city, pages, fmt, delay, port):
    city_code = city if city in CITY_CODES and city.isdigit() else CITY_CODES.get(city, city)
    if not city_code or not str(city_code).isdigit():
        raise ValueError(f"未知城市：{city}，请用 --city-code 传城市码（全量码表见 /wapi/zpCommon/data/cityGroup.json）")
    ensure_chrome_running(port)
    session = _new_session(port)
    session.send("Network.enable")
    session.send("Page.enable")
    all_rows, failed = [], []
    for page in range(1, pages + 1):
        try:
            rows = fetch_page(session, keyword, city_code, page, delay)
            all_rows.extend(rows)
            print(f"[fetch] 第 {page} 页 OK，累计 {len(all_rows)} 条", flush=True)
        except Exception as e:
            failed.append(page)
            print(f"[fetch] 第 {page} 页失败：{e}", flush=True)
            time.sleep(delay)  # 失败也给缓冲，不硬闯
    session.close()
    if all_rows:
        paths = export_rows(all_rows, keyword, city_code, fmt)
        for k, p in paths.items():
            print(f"[export] {k.upper()} -> {p}")
    else:
        print("[fetch] 未抓到数据（检查登录是否有效）")
    if failed:
        print(f"[fetch] 失败页：{failed}，已抓数据已保存，可缩小 --pages 重跑。")
    return all_rows


# ---------------------------------------------------------------- CLI 入口

def main():
    ap = argparse.ArgumentParser(description="BOSS直聘职位/公司名采集（CDP 方案）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("setup", help="启动专用 Chrome 并等待扫码登录（仅首次）")
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
    if args.cmd == "setup":
        ensure_chrome_running(args.port)
        cc = CITY_CODES.get(args.city, args.city)
        login_wait(args.keyword, cc, args.port, args.login_timeout)
    elif args.cmd == "fetch":
        try:
            run_fetch(args.keyword, args.city, args.pages, args.format, args.delay, args.port)
        except Exception as e:
            print(f"[error] {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()