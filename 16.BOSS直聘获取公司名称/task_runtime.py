"""任务线程与日志边界。仅捕获当前工作线程的输出，不吞掉主线程或其他任务的日志。"""
from contextlib import contextmanager
import io
import os
import sys
import tempfile
import threading
import time
import traceback

_CAPTURE_LOCK = threading.RLock()
_CAPTURES = {}
_PROXIES = None


class ThreadStream:
    def __init__(self, fallback):
        self.fallback = fallback

    def _target(self):
        with _CAPTURE_LOCK:
            return _CAPTURES.get(threading.get_ident(), self.fallback)

    def write(self, text):
        return self._target().write(text)

    def flush(self):
        return self._target().flush()

    def __getattr__(self, name):
        return getattr(self._target(), name)


@contextmanager
def capture_output(buffer):
    global _PROXIES
    ident = threading.get_ident()
    with _CAPTURE_LOCK:
        if ident in _CAPTURES:
            raise RuntimeError("同一线程不能重复建立任务输出捕获")
        if not _CAPTURES:
            _PROXIES = (ThreadStream(sys.stdout), ThreadStream(sys.stderr))
            sys.stdout, sys.stderr = _PROXIES
        _CAPTURES[ident] = buffer
    try:
        yield
    finally:
        with _CAPTURE_LOCK:
            _CAPTURES.pop(ident, None)
            if not _CAPTURES:
                stdout_proxy, stderr_proxy = _PROXIES
                # 不覆盖其他组件在任务运行期间主动更换的输出流。
                if sys.stdout is stdout_proxy:
                    sys.stdout = stdout_proxy.fallback
                if sys.stderr is stderr_proxy:
                    sys.stderr = stderr_proxy.fallback
                _PROXIES = None


class TaskBuffer(io.StringIO):
    def __init__(self):
        super().__init__()
        self._lock = threading.RLock()

    def write(self, value):
        with self._lock:
            return super().write(value)

    def getvalue(self):
        with self._lock:
            return super().getvalue()


class TaskRunner:
    def __init__(self, log_dir=None):
        self.log_dir = log_dir
        self.task = None
        self._lock = threading.RLock()
        self._thread = None

    @property
    def running(self):
        with self._lock:
            return self.task is not None and not self.task["done"]

    def start(self, desc, fn, args=(), with_progress=False, total=0, cancellable=False):
        with self._lock:
            if self.running:
                return False
            buf = TaskBuffer()
            buf.write(f"[task] {desc}\n")
            task = {"desc": desc, "fn": fn, "args": args, "buf": buf,
                    "done": False, "error": None, "result": None,
                    "log_path": None, "log_error": None,
                    "current": 0, "total": int(total or 0), "stage": "准备中", "detail": "任务已创建",
                    "started_at": time.monotonic(), "stop_event": threading.Event()}
            self.task = task

            def report_progress(current=0, total=0, stage="运行中", detail=""):
                with self._lock:
                    if self.task is not task or task["done"]:
                        return
                    task.update(current=max(0, int(current or 0)), stage=str(stage or "运行中"),
                                detail=str(detail or ""), updated_at=time.monotonic())
                    if total:
                        task["total"] = max(0, int(total))

            def worker():
                try:
                    with capture_output(buf):
                        kwargs = {"stop_event": task["stop_event"]} if cancellable else {}
                        if with_progress:
                            kwargs["progress"] = report_progress
                        task["result"] = fn(*args, **kwargs)
                except (Exception, SystemExit, KeyboardInterrupt) as exc:
                    task["error"] = exc
                    task["stage"] = "失败"
                    task["detail"] = f"{type(exc).__name__}: {exc}"
                    traceback.print_exc(file=buf)
                finally:
                    self._finish_task(task)

            self._thread = threading.Thread(target=worker, daemon=False)
            try:
                self._thread.start()
            except RuntimeError as exc:
                task["error"] = exc
                task["stage"] = "失败"
                traceback.print_exc(file=buf)
                self._finish_task(task)
            return True

    def _finish_task(self, task):
        buf = task["buf"]
        task["updated_at"] = time.monotonic()
        task["finished_at"] = time.time()
        status = getattr(task["result"], "status", task["stage"])
        buf.write(f"[task] 结束：stage={status}; result_type={type(task['result']).__name__}\n")
        try:
            if self.log_dir is not None:
                os.makedirs(self.log_dir, exist_ok=True)
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", errors="replace", delete=False,
                                                 dir=self.log_dir, prefix="task_" + time.strftime("%Y%m%d_%H%M%S_"),
                                                 suffix=".log") as logfile:
                    logfile.write(buf.getvalue())
                    logfile.flush()
                    task["log_path"] = logfile.name
        except OSError as exc:
            task["log_error"] = str(exc)
            buf.write(f"[log] 日志保存失败：{exc}\n")
        finally:
            with self._lock:
                task["done"] = True

    def request_stop(self):
        with self._lock:
            if self.running:
                self.task["stop_event"].set()

    def wait(self):
        with self._lock:
            thread = self._thread
        if thread is not None and thread is not threading.current_thread() and thread.ident is not None:
            thread.join()

    def snapshot_lines(self, max_lines=200):
        with self._lock:
            task = self.task
        if task is None or max_lines <= 0:
            return []
        return task["buf"].getvalue().splitlines()[-max_lines:]

    def finish(self):
        with self._lock:
            if self.running:
                raise RuntimeError("任务仍在运行，不能清除任务引用")
            task = self.task
            self.task = None
            return task
