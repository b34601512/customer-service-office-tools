# -*- coding: utf-8 -*-
"""驱动真实 TUI 走完整下载流程：按6进下载页 → 回车开始 → 完成后回车返回 → 退出。
捕获每一帧渲染画面到 tui_frames.txt，供观察下载页在真实流程中的表现。"""
import sys, time, threading, queue, io
sys.path.insert(0, '.')
from missed_call_backend.cli_app import CliApplication
from missed_call_backend.tui_app import TuiApp
from missed_call_backend.tui_pages import create_pages
from missed_call_backend.download_tasks import DOWNLOAD_TASKS
from missed_call_backend.cli_display import strip_ansi

class FakeOutput:
    def __init__(self):
        self.columns = 100
        self.rows = 28
        self.frames = []
        self._buf = []
    def write(self, s):
        self._buf.append(s)
    def flush(self):
        text = ''.join(self._buf)
        self._buf = []
        # 保留换行结构、去掉 ANSI，便于阅读
        self.frames.append(strip_ansi(text))

app = CliApplication()
app.prepare_runtime()
app.refresh_result()
app.register_exit_signals()

out = FakeOutput()
tui = TuiApp("电话漏接分析", create_pages(), app, status_provider=app._tui_status_lines, output=out)

key_queue = queue.Queue()
key_queue.put('6')      # 进下载页
key_queue.put('enter')  # 开始下载

known_tasks = set(DOWNLOAD_TASKS.keys())
stop_flag = threading.Event()

def monitor():
    """等待下载任务完成或超时，注入对应按键。"""
    deadline = time.time() + 240
    while not stop_flag.is_set() and time.time() < deadline:
        new_tasks = [tid for tid in DOWNLOAD_TASKS if tid not in known_tasks]
        active = [tid for tid in new_tasks if DOWNLOAD_TASKS[tid].get('status') in ('done', 'error')]
        if active:
            time.sleep(0.6)   # 等下载页渲染完成状态
            key_queue.put('enter')  # 返回首页
            time.sleep(0.6)
            key_queue.put('ctrl-c') # 退出
            return
        time.sleep(0.3)
    # 超时（卡住）也退出，保留现场
    key_queue.put('ctrl-c')

threading.Thread(target=monitor, daemon=True).start()

def fake_read_key(timeout=None):
    try:
        return key_queue.get_nowait()
    except queue.Empty:
        return None

tui.read_key = fake_read_key
try:
    tui.run()
finally:
    stop_flag.set()
    app.cleanup_runtime()
    # 记录最后一帧
    if out.frames:
        with open('tui_frames.txt', 'w', encoding='utf-8') as f:
            f.write('\n'.join(out.frames))
    # 打印任务最终状态
    for tid, task in DOWNLOAD_TASKS.items():
        print('FINAL_TASK status=%s progress=%s stage=%s msg=%s' % (task.get('status'), task.get('progress'), task.get('stage'), str(task.get('message'))[:60]))
    print('FRAMES=%d' % len(out.frames))
