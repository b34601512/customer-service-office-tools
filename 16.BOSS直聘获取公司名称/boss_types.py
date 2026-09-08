"""采集结果与错误契约。状态来自业务事实，不从日志文字或文件数量猜测。"""
import math
import re


class FetchResult(list):
    """保留旧调用方的 list 接口，同时提供准确的终态、文件路径和页数。"""
    EXIT_CODES = {"completed": 0, "empty": 0, "partial": 2,
                  "blocked": 3, "cancelled": 130, "failed": 1}

    def __init__(self, rows=(), *, status="completed", requested_pages=0):
        super().__init__(rows)
        self.status = status
        self.requested_pages = requested_pages
        self.completed_pages = 0
        self.failed_pages = []
        self.paths = {}
        self.checkpoint = None
        self.reason = ""
        self.missing_company_count = 0

    @property
    def exit_code(self):
        return self.EXIT_CODES.get(self.status, 1)


class FetchError(RuntimeError):
    def __init__(self, message, *, result=None):
        super().__init__(message)
        self.result = result


class ResponseSchemaError(FetchError):
    """返回结构变了，不得把解析失败当作零条结果。"""


class SiteResponseError(FetchError):
    def __init__(self, code, message="", *, page=None, result=None):
        self.code = code
        self.page = page
        prefix = f"第 {page} 页" if page is not None else "网站"
        super().__init__(f"{prefix}返回 code:{code} {message}".strip(), result=result)


class VerificationRequired(SiteResponseError):
    """停止自动请求，保留页面，等待用户正常登录/验证；不绕过网站限制。"""


class FetchCancelled(FetchError):
    pass


class ProtocolError(FetchError):
    pass


def positive_integer(value, name, maximum):
    # int(1.9)、int(True) 都会静默改变参数，这里明确拒绝。
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]+", str(value).strip()):
        raise ValueError(f"{name}必须是 1-{maximum} 的整数：{value!r}")
    number = int(str(value).strip())
    if not 1 <= number <= maximum:
        raise ValueError(f"{name}必须是 1-{maximum} 的整数：{value!r}")
    return number


def finite_seconds(value, name, maximum=3600):
    if isinstance(value, bool):
        raise ValueError(f"{name}必须是 0-{maximum} 的有限秒数")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name}必须是数字：{value!r}") from exc
    if not math.isfinite(number) or not 0 <= number <= maximum:
        raise ValueError(f"{name}必须是 0-{maximum} 的有限秒数：{value!r}")
    return number


def check_cancelled(stop_event):
    if stop_event is not None and stop_event.is_set():
        raise FetchCancelled("用户已停止采集")
