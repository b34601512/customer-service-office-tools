"""单标签页 CDP 传输层：命令/事件分流、会话隔离、响应完成后读正文。"""
from collections import deque
import json
import time
import urllib.parse

from websocket import create_connection, WebSocketTimeoutException
from boss_types import ProtocolError, check_cancelled

JOBLIST_PATH_PART = "/wapi/zpgeek/search/joblist.json"
MAX_PENDING = 512
MAX_EVENTS = 4096


def is_joblist_url(url):
    parsed = urllib.parse.urlsplit(url)
    return (parsed.hostname in ("www.zhipin.com", "zhipin.com")
            and parsed.path == JOBLIST_PATH_PART)


class CDPSession:
    def __init__(self, ws_url, timeout=60, *, stop_event=None):
        self.ws = create_connection(ws_url, timeout=timeout)
        self._id = 0
        self._pending = {}
        self._events = deque()
        self._responses = {}
        self._ready = deque()
        self.joblist_requests = {}
        self.expected_joblist = None
        self.stop_event = stop_event
        self.keep_open = False
        self._closed = False

    def send(self, method, params=None):
        self._id += 1
        mid = self._id
        self._pending[mid] = None
        # 少量不等待的命令响应也必须有内存上限。
        while len(self._pending) > MAX_PENDING:
            self._pending.pop(next(iter(self._pending)))
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        return mid

    def _recv_json(self, timeout):
        check_cancelled(getattr(self, "stop_event", None))
        previous = self.ws.gettimeout()
        self.ws.settimeout(max(0.01, float(timeout)))
        try:
            raw = self.ws.recv()
            if not raw:
                raise ConnectionError("CDP 连接已关闭；请检查专用浏览器是否仍在运行")
            message = json.loads(raw)
            if not isinstance(message, dict):
                raise ProtocolError("CDP 返回了非对象消息")
            return message
        except WebSocketTimeoutException:
            return None
        finally:
            self.ws.settimeout(previous)

    def _record_request(self, message):
        params = message.get("params", {})
        request = params.get("request", {})
        if (message.get("method") != "Network.requestWillBeSent"
                or not is_joblist_url(request.get("url", ""))):
            return
        request_id = params.get("requestId")
        if not request_id:
            return
        fields = urllib.parse.parse_qs(urllib.parse.urlsplit(request["url"]).query,
                                      keep_blank_values=True)
        body = request.get("postData", "")
        if body:
            if body.lstrip().startswith("{"):
                try:
                    payload = json.loads(body)
                except ValueError as exc:
                    raise ProtocolError("joblist 请求参数不是有效 JSON") from exc
                if not isinstance(payload, dict):
                    raise ProtocolError("joblist 请求参数不是对象")
                fields.update({key: [str(value)] for key, value in payload.items()})
            else:
                fields.update(urllib.parse.parse_qs(body, keep_blank_values=True))
        self.joblist_requests[request_id] = fields
        if len(self.joblist_requests) > MAX_EVENTS:
            raise ProtocolError("joblist 请求缓存超限，请结束本次任务后检查页面")

    def _record_event(self, message):
        self._record_request(message)
        params = message.get("params", {})
        request_id = params.get("requestId")
        method = message.get("method")
        if method == "Network.responseReceived":
            if is_joblist_url(params.get("response", {}).get("url", "")):
                self._responses[request_id] = params
        elif method in ("Network.loadingFinished", "Network.loadingFailed"):
            response = self._responses.pop(request_id, None)
            if response is None and method == "Network.loadingFailed" and request_id in self.joblist_requests:
                # DNS/连接失败可能完全没有 responseReceived，仍须立即报告而不是等满超时。
                response = {"requestId": request_id, "response": {}}
            if response is not None:
                response = dict(response)
                if method == "Network.loadingFailed":
                    response["_failure"] = params.get("errorText", "网络加载失败")
                self._ready.append(response)
                if len(self._ready) > MAX_EVENTS:
                    raise ProtocolError("joblist 响应缓存超限")

    def _cache_response(self, message):
        # 不缓存已经过期/被调用方遗弃的命令响应。
        if message["id"] in self._pending:
            self._pending[message["id"]] = message

    def wait_response(self, mid, timeout=30):
        cached = self._pending.get(mid)
        if cached is not None:
            return self._pending.pop(mid)
        deadline = time.monotonic() + max(0, timeout)
        while time.monotonic() < deadline:
            message = self._recv_json(min(1, deadline - time.monotonic()))
            if message is None:
                continue
            if "id" in message:
                if message["id"] == mid:
                    self._pending.pop(mid, None)
                    return message
                self._cache_response(message)
            else:
                self._record_event(message)
                # 命令等待期间收到的文档事件留给详情读取器，不丢事件。
                if len(self._events) >= MAX_EVENTS:
                    raise ProtocolError("CDP 事件缓存超限")
                self._events.append(message)
        self._pending.pop(mid, None)
        return None

    def command(self, method, params=None, timeout=15):
        response = self.wait_response(self.send(method, params), timeout=timeout)
        if response is None:
            raise TimeoutError(f"CDP 命令超时：{method}")
        if "error" in response:
            raise ProtocolError(f"CDP 命令失败：{method}；{response['error'].get('message', '未知错误')}")
        result = response.get("result", {})
        if result.get("errorText") or result.get("exceptionDetails"):
            raise ProtocolError(f"CDP 命令执行异常：{method}")
        return result

    def recv_event(self, timeout=30):
        if self._events:
            return self._events.popleft()
        message = self._recv_json(timeout)
        if message is None:
            return None
        if "id" in message:
            self._cache_response(message)
            return None
        self._record_event(message)
        return message

    def pop_joblist(self):
        # 预加载的后续页先保留，等调用方切换 expected_joblist 后再消费。
        for _ in range(len(self._ready)):
            params = self._ready.popleft()
            actual = self.joblist_requests.get(params.get("requestId"), {})
            if not self.expected_joblist or not actual or all(
                    actual.get(key, [None])[0] == str(value)
                    for key, value in self.expected_joblist.items()):
                return params
            self._ready.append(params)
        return None

    def reset_joblist(self):
        self.joblist_requests.clear()
        self._responses.clear()
        self._ready.clear()

    def close(self):
        if self._closed:
            return
        self._closed = True
        # 停止令牌不能阻止资源清理。保留验证页时只断开调试连接。
        self.stop_event = None
        try:
            if not self.keep_open:
                self.command("Page.close", timeout=2)
        except Exception:
            pass
        finally:
            try:
                self.ws.close()
            except Exception:
                pass
